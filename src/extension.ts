// Copyright 2018 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict';
import * as vscode from 'vscode';
const BigQuery = require('@google-cloud/bigquery');
const toCSV = require('csv-stringify');
const easyTable = require('easy-table');
const flatten = require('flat');

const configPrefix = 'bigquery';
let config: vscode.WorkspaceConfiguration;
const output = vscode.window.createOutputChannel('BigQuery');

// const {DataCatalogClient} = require('@google-cloud/datacatalog').v1;
// const dataCatalog = new DataCatalogClient();

// CommandMap describes a map of extension commands (defined in package.json)
// and the function they invoke.
type CommandMap = Map<string, () => void>;
// eslint-disable-next-line func-call-spacing
const commands: CommandMap = new Map<string, () => void>([
  ['extension.runAsQuery', runAsQuery],
  ['extension.runSelectedAsQuery', runSelectedAsQuery],
  ['extension.dryRun', dryRun],
]);

// eslint-disable-next-line require-jsdoc
export function activate(ctx: vscode.ExtensionContext) {
  config = readConfig();

  // Register all available commands and their actions.
  commands.forEach((action, name) => {
    ctx.subscriptions.push(vscode.commands.registerCommand(name, action));
  });

  // Listen for configuration changes and trigger an update, so that users don't
  // have to reload the VS Code environment after a config update.
  ctx.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(configPrefix)) {
          return;
        }

        config = readConfig();
      }),
  );

  ctx.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(
          {language: 'sql', scheme: 'file'},
          {
            provideCompletionItems(
                document: vscode.TextDocument, position: vscode.Position) {
              // eslint-disable-next-line new-cap
              return provideCompletionItems(document, position, BigQuery({
                keyFilename: config.get('keyFilename'),
                email: config.get('email'),
              }));
            },
          },
          '.',
      ),
  );
}

/**
 * Provides completion items for the vscode API.
 * @param {vscode.TextDocument} textDocument The text document.
 * @param {vscode.Position} position The position of the cursor.
 * @param {any} bqClient The BigQuery client.
 */
export async function provideCompletionItems(
    textDocument: vscode.TextDocument, position: vscode.Position,
    bqClient: any) {
  const text = textDocument.getText();
  const table = extractTableName(text, position.line);
  if (!table) {
    return Promise.resolve([]);
  }

  const wordRange: vscode.Range = textDocument.getWordRangeAtPosition(
      position, /[\w\.]+/);
  const word: string = textDocument.getText(wordRange);
  const lastDotInWord: number = word.lastIndexOf('.');

  bqClient.projectId = (
    table.project ? table.project : config.get('projectId'));

  return bqClient.dataset(table.dataset)
      .table(table.table)
      .getMetadata()
      .then((metadata) => {
        if (!metadata[0].schema) {
          return [];
        }
        return flattenFields(metadata[0].schema.fields).map((field) => {
          if (lastDotInWord >= 0 &&
            field.name.startsWith(word.substring(0, lastDotInWord + 1))) {
            return {
              label: {
                label: '…' + field.name.substring(lastDotInWord + 1),
                detail: ' ' + getTypeName(field),
              },
              insertText: field.name,
              filterText: field.name,
              // Make sure that these come on top.
              sortText: 'AAA' + field.name,
              kind: vscode.CompletionItemKind.Field,
              range: wordRange,
            };
          } else {
            return {
              label: {
                label: field.name,
                detail: ' ' + getTypeName(field),
              },
              kind: vscode.CompletionItemKind.Field,
              range: wordRange,
            };
          }
        });
      });
}

/**
 * Get the displayable type for a column.
 * @param {any} field The field object that contains type and mode.
 * @return {string} The type name to be shown to the user.
 */
function getTypeName(field: any): string {
  if (field.mode === 'REPEATED') {
    return 'ARRAY<' + field.type + '>';
  } else {
    return field.type;
  }
}

/**
 * Extract the table name from a SQL query document.
 * @param {string} text The SQL query document.
 * @param {number} line The line the cursor is currently on.
 * @return {any} The table object.
 */
export function extractTableName(text: string, line: number):
{ project: string, dataset: string, table: string } | undefined {
  const lines = text.split('\n');
  for (let i = line; i < lines.length; i++) {
    const match = lines[i].match(
        /FROM\s+`?((?<project>\w+)\.)?(?<dataset>\w+)\.(?<table>\w+)`?/i);
    if (!match) {
      continue;
    }

    return {
      project: match.groups.project,
      dataset: match.groups.dataset,
      table: match.groups.table,
    };
  }
  return undefined;
}

/**
 * Flatten the nested field dictionary to an array.
 * @param {any[]} fields The list of field dictionary objects.
 * @return {any[]} The flatten list of fields.
 */
export function flattenFields(fields: any[]): any[] {
  return fields.reduce((acc, field) => {
    if (field.fields) {
      acc = acc.concat(flattenFields(field.fields).map((nestedField) => {
        nestedField.name = field.name + '.' + nestedField.name;
        return nestedField;
      }));
    }
    delete field.fields;
    acc.push(field);

    return acc;
  }, []);
}

/**
 * Read the config from file.
 * @return {vscode.WorkspaceConfiguration} The config file as an object.
 */
function readConfig(): vscode.WorkspaceConfiguration {
  try {
    return vscode.workspace.getConfiguration(configPrefix);
  } catch (e) {
    vscode.window.showErrorMessage(`failed to read config: ${e}`);
  }
}

/**
 * Issue a query job.
 * @param {string} queryText The query text.
 * @param {boolean} isDryRun Whether dry-run is requested. Defaults to False.
 * @return {Promise<any>} The promise on the result.
 */
function query(queryText: string, isDryRun?: boolean): Promise<any> {
  // eslint-disable-next-line new-cap
  const client = BigQuery({
    keyFilename: config.get('keyFilename'),
    projectId: config.get('projectId'),
    email: config.get('email'),
  });

  let id: string;
  const job = client
      .createQueryJob({
        query: queryText,
        location: config.get('location'),
        maximumBytesBilled: config.get('maximumBytesBilled'),
        useLegacySql: config.get('useLegacySql'),
        dryRun: !!isDryRun,
      })
      .then((data) => {
        const job = data[0];
        id = job.id;
        const jobIdMessage = `BigQuery job ID: ${job.id}`;
        if (isDryRun) {
          vscode.window.showInformationMessage(`${jobIdMessage} (dry run)`);
          const totalBytesProcessed =
              job.metadata.statistics.totalBytesProcessed;
          writeDryRunSummary(id, totalBytesProcessed);
          return null;
        }
        vscode.window.showInformationMessage(jobIdMessage);

        return job.getQueryResults({
          autoPaginate: true,
        });
      })
      .catch((err) => {
        vscode.window.showErrorMessage(`Failed to query BigQuery: ${err}`);
        return null;
      });

  return job
      .then((data) => {
        if (data) {
          writeResults(id, data[0]);
        }
      })
      .catch((err) => {
        vscode.window.showErrorMessage(`Failed to get results: ${err}`);
      });
}

/**
 * Write result of a query to the console.
 * @param {string} jobId The job ID to write result from.
 * @param {Array<any>} rows The row content to write.
 */
function writeResults(jobId: string, rows: Array<any>): void {
  output.show();
  output.appendLine(`Results for job ${jobId}:`);

  const format = config
      .get('outputFormat')
      .toString()
      .toLowerCase();

  switch (format) {
    case 'csv':
      toCSV(rows, (err, res) => {
        output.appendLine(res);
      });

      break;
    case 'table':
      // eslint-disable-next-line new-cap
      const t = new easyTable();

      // Collect the header names; flatten nested objects into a
      // recordname.recordfield format
      const headers = [];
      Object.keys(flatten(rows[0])).forEach((name) => headers.push(name));

      rows.forEach((val, idx) => {
        // Flatten each row, and for each header (name), insert the matching
        // object property (v[name])
        const v = flatten(val, {safe: true});
        headers.forEach((name, col) => {
          t.cell(name, v[name]);
        });
        t.newRow();
      });

      output.appendLine(t.toString());

      break;
    default:
      const spacing = config.get('prettyPrintJSON') ? '  ' : '';
      rows.forEach((row) => {
        output.appendLine(
            JSON.stringify(flatten(row, {safe: true}), null, spacing),
        );
      });
  }
}

/**
 * Write dry-run summary to the console.
 * @param {string} jobId The job ID of the dry-run job.
 * @param {string} numBytesProcessed Number of bytes processed according to
 * the dry-run.
 */
function writeDryRunSummary(jobId: string, numBytesProcessed: string) {
  output.show();
  output.appendLine(`Results for job ${jobId} (dry run):`);
  output.appendLine(`Total bytes processed: ${numBytesProcessed}`);
  output.appendLine(``);
}

/**
 * Get query text from the editor.
 * @param {vscode.TextEditor} editor The text editor object to look from.
 * @param {boolean} onlySelected If true, only return the selected portion
 * of the editor, otherwise return everything in it.
 * @return {string} The query string requested by the user.
 */
function getQueryText(
    editor: vscode.TextEditor,
    onlySelected?: boolean,
): string {
  if (!editor) {
    throw new Error('No active editor window was found');
  }

  // Only return the selected text
  if (onlySelected) {
    const selection = editor.selection;
    if (selection.isEmpty) {
      throw new Error('No text is currently selected');
    }

    return editor.document.getText(selection).trim();
  }

  const text = editor.document.getText().trim();
  if (!text) {
    throw new Error('The editor window is empty');
  }

  return text;
}

/**
 * Run the query from the editor.
 */
function runAsQuery(): void {
  try {
    const queryText = getQueryText(vscode.window.activeTextEditor);
    query(queryText);
  } catch (err) {
    vscode.window.showErrorMessage(err);
  }
}

/**
 * Run the selected portion of the editor as a query.
 */
function runSelectedAsQuery(): void {
  try {
    const queryText = getQueryText(vscode.window.activeTextEditor, true);
    query(queryText);
  } catch (err) {
    vscode.window.showErrorMessage(err);
  }
}

/**
 * Dry-run the query in the editor.
 */
function dryRun(): void {
  try {
    const queryText = getQueryText(vscode.window.activeTextEditor);
    query(queryText, true);
  } catch (err) {
    vscode.window.showErrorMessage(err);
  }
}

// eslint-disable-next-line require-jsdoc
export function deactivate() {}
