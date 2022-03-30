use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;

use ra::cli::load_cargo::{load_workspace, LoadCargoConfig};
use ra_ide::{
    Analysis, AnalysisHost, Change, CompletionConfig, Diagnostic, DiagnosticsConfig, FileId,
    FilePosition, HoverResult, LineCol, LineIndex, StaticIndex, TextRange, TextSize, TokenId,
    TokenStaticData,
};
use ra_ide_db::imports::insert_use::{ImportGranularity, InsertUseConfig, PrefixKind};
use ra_ide_db::SnippetCap;
use ra_project_model::{CargoConfig, ProjectManifest, ProjectWorkspace};
use ra_vfs::{AbsPathBuf, VfsPath};
use tempfile::TempDir;

use crate::query_parser::find_queries;
use crate::twoslash::{CompletionEntry, Error, Query, QueryKind, StaticQuickInfo, TwoSlash};

#[derive(Copy, Clone)]
pub struct ProjectSettings<'a> {
    pub make_cargo_project: bool,
    pub project_name: &'a str,
    pub tmpdir: &'a TempDir,
}

struct Position {
    start: u32,
    length: u32,
    line: u32,
    character: u32,
}

pub struct Project {
    cut: Cut,

    host: Option<AnalysisHost>,
    analysis: Analysis,
    queries: Vec<(QueryKind, TextSize)>,

    line_index: LineIndex,
    token_to_ranges: HashMap<TokenId, Vec<TextRange>>,
    token_data: Vec<(TokenId, TokenStaticData)>,

    fid: FileId,
}

/// Bootstraps a cargo project in a directory, and returns the paths of the
/// project root and lib.rs.
fn bootstrap_project_in(
    dir: &TempDir,
    project_name: &str,
    source: &str,
) -> Result<(PathBuf, PathBuf)> {
    let root = dir.path();
    let lib_rs = root.join("src/lib.rs");

    // /root
    // |- Cargo.toml
    // |- src
    //    |- lib.rs
    let cargo_toml = root.join("Cargo.toml");
    fs::write(
        cargo_toml,
        format!(
            r#"
[package]
edition = "2021"
name = "{}"
version = "0.0.0"
"#,
            project_name,
        )
        .trim(),
    )?;

    fs::create_dir(root.join("src"))?;

    fs::write(lib_rs.clone(), source)?;

    Ok((root.to_path_buf(), lib_rs))
}

fn pre_index(
    analysis: &Analysis,
    fid: FileId,
    source: &str,
) -> (
    HashMap<TokenId, Vec<TextRange>>,
    Vec<(TokenId, TokenStaticData)>,
    LineIndex,
    Cut,
) {
    let si = StaticIndex::compute(&analysis);

    let mut token_to_ranges = HashMap::<TokenId, Vec<TextRange>>::default();
    for (range, id) in si
        .files
        .iter()
        .find(|fi| fi.file_id == fid)
        .unwrap()
        .tokens
        .iter()
    {
        token_to_ranges.entry(*id).or_default().push(*range);
    }
    let token_data = si.tokens.iter().collect();

    let line_index = LineIndex::new(source);
    let cut = Cut::new(source, &line_index);

    (token_to_ranges, token_data, line_index, cut)
}

impl Project {
    pub fn scaffold(settings: ProjectSettings) -> Result<Project> {
        Self::scaffold_with_code(
            settings,
            // Basis code for scaffolding
            r#"pub fn foo() -> usize { 1 }"#,
        )
    }

    /// Let `scaffold`, but injects user code immediately.
    pub fn scaffold_with_code<'a>(settings: ProjectSettings, source: &'a str) -> Result<Project> {
        let (source, queries) = find_queries(source);

        let (host, analysis, fid) = if !settings.make_cargo_project {
            let (analysis, fid) = Analysis::from_single_file(source.to_string());
            (None, analysis, fid)
        } else {
            let (root, lib_rs) =
                bootstrap_project_in(settings.tmpdir, settings.project_name, &source)?;

            let cargo_config = CargoConfig::default();
            let no_progress = &|_| ();
            let load_cargo_config = LoadCargoConfig {
                load_out_dirs_from_check: true,
                with_proc_macro: false,
                prefill_caches: false,
            };
            let path = AbsPathBuf::assert(root);
            let manifest = ProjectManifest::discover_single(&path)?;

            let workspace = ProjectWorkspace::load(manifest, &cargo_config, no_progress)?;

            let (host, vfs, _proc_macro) = load_workspace(workspace, &load_cargo_config)?;

            let analysis = host.analysis();

            let _si = StaticIndex::compute(&analysis);

            let fid = vfs
                .file_id(&VfsPath::new_real_path(lib_rs.display().to_string()))
                .unwrap();
            let analysis = host.analysis();

            (Some(host), analysis, fid)
        };

        let (token_to_ranges, token_data, line_index, cut) = pre_index(&analysis, fid, &source);

        Ok(Project {
            cut,

            host,
            analysis,
            queries,

            line_index,
            token_to_ranges,
            token_data,

            fid,
        })
    }

    pub fn apply_change(self, new_code: String) -> Self {
        // The analysis is now stale. Drop it so that we don't block host update below.
        drop(self.analysis);

        let (new_code, queries) = find_queries(&new_code);

        let (host, analysis, fid) = match self.host {
            Some(mut host) => {
                let mut changes = Change::new();
                changes.change_file(self.fid, Some(Arc::new(new_code.clone())));
                host.apply_change(changes);
                let analysis = host.analysis();
                (Some(host), analysis, self.fid)
            }
            None => {
                // This is a standalone rust script.
                let (analysis, fid) = Analysis::from_single_file(new_code.clone());
                (None, analysis, fid)
            }
        };

        let (token_to_ranges, token_data, line_index, cut) = pre_index(&analysis, fid, &new_code);

        Self {
            host,
            analysis,
            queries,
            fid,
            token_to_ranges,
            token_data,
            line_index,
            cut,
            ..self
        }
    }

    /// Returns the TS-style position from this range, or `None` if the range should not be
    /// considered (because it is outside the cut range).
    fn to_position(&self, range: TextRange) -> Option<Position> {
        let (start, end) = (range.start(), range.end());
        let LineCol {
            line,
            col: character,
        } = self.line_index.line_col(start);
        match self.cut.line_in_cut(line) {
            true => Some(Position {
                start: u32::from(start) - self.cut.start_offset,
                length: (end - start).into(),
                line: line - self.cut.start_line,
                character,
            }),
            false => None,
        }
    }

    fn diagnostics(&self) -> Result<Vec<Error>> {
        let diags = self
            .analysis
            .diagnostics(
                &DiagnosticsConfig::default(),
                ra_ide::AssistResolveStrategy::None,
                self.fid,
            )?
            .into_iter()
            .filter_map(|diag| {
                let Diagnostic {
                    code,
                    message,
                    range,
                    severity,
                    ..
                } = diag;
                self.to_position(range).map(
                    |Position {
                         start,
                         length,
                         line,
                         character,
                     }| {
                        Error {
                            code: 0,
                            id: code.as_str().to_string(),
                            rendered_message: message,
                            category: severity.into(),
                            start,
                            length,
                            line,
                            character,
                        }
                    },
                )
            })
            .collect();
        Ok(diags)
    }

    fn ident_hovers(&self) -> Result<Vec<StaticQuickInfo>> {
        let hovers = self
            .token_data
            .iter()
            .filter_map(|(id, token)| token.hover.as_ref().map(|hover| (id, hover)))
            .flat_map(|(id, hover): (&TokenId, &HoverResult)| {
                self.token_to_ranges
                    .get(&id)
                    .map(|ranges| {
                        // Annoying, but we have to do this here. We can't unwrap_or_default first
                        // because then we take a reference to a Vec, and rustc thinks we return
                        // meaningful data inside that temporary.
                        ranges
                            .iter()
                            .map(|range| (range, hover))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default()
            })
            .filter_map(|(range, hover)| {
                self.to_position(*range).map(
                    |Position {
                         start,
                         length,
                         line,
                         character,
                     }| {
                        let target_string = self.cut.source
                            [(start as usize)..((start + length) as usize)]
                            .to_string();

                        let markup = hover.markup.to_string();
                        let text = ra_hover_to_text(markup);

                        StaticQuickInfo {
                            target_string,
                            text,
                            docs: None,
                            start,
                            length,
                            line,
                            character,
                        }
                    },
                )
            })
            .collect();
        Ok(hovers)
    }

    fn find_hover_data_at_position(&self, pos: TextSize) -> Option<(TextRange, &HoverResult)> {
        let hover_from_static_index = self.token_data.iter().find_map(|(id, data)| {
            let range = self
                .token_to_ranges
                .get(id)
                .and_then(|ranges| ranges.iter().find(|range| range.contains(pos)));
            match (range, data.hover.as_ref()) {
                (Some(range), Some(data)) => Some((*range, data)),
                _ => None,
            }
        });
        hover_from_static_index
    }

    fn query(&self, pos: TextSize) -> Result<Query> {
        let (range, info) = match self.find_hover_data_at_position(pos) {
            None => return Err(anyhow::Error::msg("")),
            Some(info) => info,
        };
        let Position {
            start,
            length,
            line,
            character,
        } = match self.to_position(range) {
            None => return Err(anyhow::Error::msg("")),
            Some(pos) => pos,
        };

        let markup = info.markup.to_string();
        let text = ra_hover_to_text(markup);

        Ok(Query {
            kind: QueryKind::Query,
            line: line + 1,
            offset: character,
            text: Some(text),
            docs: None,
            start,
            length,
            completions: None,
            completions_prefix: None,
        })
    }

    fn completions(&self, pos: TextSize) -> Result<Query> {
        let completions_config = CompletionConfig {
            enable_postfix_completions: true,
            enable_imports_on_the_fly: true,
            enable_self_on_the_fly: true,
            enable_private_editable: true,
            add_call_parenthesis: true,
            add_call_argument_snippets: true,
            snippet_cap: SnippetCap::new(true),
            insert_use: InsertUseConfig {
                granularity: ImportGranularity::Crate,
                prefix_kind: PrefixKind::Plain,
                enforce_granularity: true,
                group: true,
                skip_glob_imports: true,
            },
            snippets: Vec::new(),
        };
        let pos = FilePosition {
            file_id: self.fid,
            offset: pos,
        };
        let completions = self.analysis.completions(&completions_config, pos)?;
        let zero_err = Err(anyhow::Error::msg(""));
        let completions = match completions {
            None => return zero_err,
            Some(info) if info.is_empty() => return zero_err,
            Some(info) => info,
        };

        let Position {
            start,
            length,
            line,
            character,
        } = match self.to_position(completions[0].source_range()) {
            None => return zero_err,
            Some(pos) => pos,
        };

        let target_string =
            self.cut.source[(start as usize)..((start + length) as usize)].to_string();

        let completions = completions
            .into_iter()
            .map(|completion| CompletionEntry {
                name: completion.label().to_string(),
            })
            .collect();

        Ok(Query {
            kind: QueryKind::Query,
            line,
            offset: character,
            text: None,
            docs: None,
            start,
            length,
            completions: Some(completions),
            completions_prefix: Some(target_string),
        })
    }

    fn queries(&self) -> Vec<Query> {
        self.queries
            .iter()
            .filter_map(|(kind, pos)| {
                match kind {
                    QueryKind::Query => self.query(*pos),
                    QueryKind::Completions => self.completions(*pos),
                }
                .ok()
            })
            .collect()
    }

    pub fn twoslasher(&self) -> Result<TwoSlash> {
        let errors = self.diagnostics()?;
        let static_quick_infos = self.ident_hovers()?;
        let queries = self.queries();

        let two_slash_result = TwoSlash {
            code: self.cut.source.to_string(),
            extension: ".rs".to_string(),
            highlights: vec![],
            static_quick_infos,
            queries,
            // TODO: real tags
            tags: vec![],
            errors,
            // TODO: real URL
            playground_url: "https://play.rust-lang.org".to_string(),
        };
        Ok(two_slash_result)
    }
}

struct Cut {
    source: String,
    start_line: u32,
    start_offset: u32,
    end_line: u32,
}

impl Cut {
    fn new(basis: &str, line_index: &LineIndex) -> Cut {
        static CUT_BEFORE_STR: &'static str = "// ---cut---\n";
        static CUT_AFTER_STR: &'static str = "// ---cut-after---\n";

        let (start_line, start_offset) = basis
            .find(CUT_BEFORE_STR)
            .map(|offset| {
                let LineCol { line, .. } = line_index.line_col(TextSize::from(offset as u32));
                let start_line = line + 1;
                let start_offset = (offset + CUT_BEFORE_STR.len()) as u32;
                (start_line, start_offset)
            })
            .unwrap_or((0, 0));
        let (end_line, end_offset) = basis
            .find(CUT_AFTER_STR)
            .map(|offset| {
                let end_line = line_index.line_col(TextSize::from(offset as u32)).line;
                let end_offset = offset as u32; // We'll pick out the trailing newline elsewhere
                (end_line, end_offset)
            })
            .unwrap_or_else(|| {
                let end_offset = basis.len() as u32;
                let end_line = line_index.line_col(TextSize::from(end_offset as u32)).line;
                let end_line = std::cmp::max(end_line, start_line + 1);
                (end_line, end_offset)
            });
        let substr = basis[start_offset as usize..end_offset as usize].to_string();
        Cut {
            source: substr,
            start_line,
            start_offset,
            end_line,
        }
    }

    fn line_in_cut(&self, line: u32) -> bool {
        line >= self.start_line && line < self.end_line
    }
}

fn ra_hover_to_text(markup: String) -> String {
    markup
        .trim()
        .lines()
        .filter(|&line| line != "```rust" && line != "```")
        .collect::<Vec<_>>()
        .join("\n")
}
