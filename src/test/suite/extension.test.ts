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

// import * as assert from "assert";
import * as vscode from "vscode";
// import * as myExtension from "../extension";
// import * as path from "path";
//
// const fixturePath = path.join(__dirname, "..", "..", "test", "fixtures");
import { extractTableName, flattenFields, provideCompletionItems } from '../../extension';

const assert = require('assert');

// Test editor <-> query text selection
suite("Query text tests", function() {
  // test("Query text is read correctly", () => {
  //   let uri = vscode.Uri.file(path.join(fixturePath, "test.sql"));
  //   // call getQueryText(editor, false)
  //   // check that expectations match via assert.equal
  // });
  // test("Query text from a selection matches", function() {
  //   let uri = vscode.Uri.file(path.join(fixturePath, "test.sql"));
  //   vscode.workspace.openTextDocument(uri).then(doc => {
  //     // select the text
  //     // call getQueryText(editor, true)
  //     // confirm that selection matches via assert.equal
  //   });
  // });
});

// Test that results are written correctly (table, CSV, JSON)
suite("Output results tests", function() {
  test("JSON output is as expected", () => {
    // Get query results from fixture
    // Set config to "json"
    // Pass to writeResults
    // Capture output and match via assert.equal
  });
});

suite('extractTableName', () => {
  test('returns undefined if no table is found', () => {
    assert.strictEqual(extractTableName('SELECT *', 0), undefined);
  });

  test('returns the dataset & table IDs', () => {
    assert.deepStrictEqual(extractTableName('SELECT *\nFROM dataset.table', 1), { project: undefined, dataset: 'dataset', table: 'table' });
  });

  test('returns the project, dataset & table IDs', () => {
    assert.deepStrictEqual(extractTableName('SELECT *\nFROM project.dataset.table', 1), { project: 'project', dataset: 'dataset', table: 'table' });
  });

  test('returns the dataset & table IDs with quotes', () => {
    assert.deepStrictEqual(extractTableName('SELECT *\nFROM `dataset.table`', 1), { project: undefined, dataset: 'dataset', table: 'table' });
  });

  test('returns the project, dataset & table IDs with quotes', () => {
    assert.deepStrictEqual(extractTableName('SELECT *\nFROM `project.dataset.table`', 1), { project: 'project', dataset: 'dataset', table: 'table' });
  });
});

suite('flattenFields', () => {
  test('flattens nested fields', () => {
    const fields = [
      {
        name: 'field1',
        fields: [
          { name: 'nested1' },
          { name: 'nested2' }
        ]
      },
      {
        name: 'field2',
        fields: [
          { name: 'nested3' },
          { name: 'nested4' }
        ]
      }
    ];

    assert.deepStrictEqual(flattenFields(fields), [
      { name: 'field1.nested1' },
      { name: 'field1.nested2' },
      { name: 'field2.nested3' },
      { name: 'field2.nested4' }
    ]);
  });
});

suite('provideCompletionItems', () => {
  let bigquery;
  let tableMetadata;
  let textDocument;
  let position;

  setup(() => {
    bigquery = {
      dataset: () => ({
        table: () => ({
          getMetadata: () => Promise.resolve([tableMetadata])
        })
      })
    };
    textDocument = {
      getText: () => 'SELECT *\nFROM project.dataset.table'
    };
    position = { line: 1 };
  });

  test('returns an empty array if no table is found', done => {
    position.line = 0;
    provideCompletionItems(textDocument, position, bigquery)
      .then(result => {
        assert.deepStrictEqual(result, []);
        done();
      });
  });

  test('returns the completion items', done => {
    tableMetadata = {
      schema: {
        fields: [
          { name: 'field1.nested1' },
          { name: 'field1.nested2' },
          { name: 'field2.nested3' },
          { name: 'field2.nested4' }
        ]
      }
    };
    let makeCompletionItem = (label: string, kind: vscode.CompletionItemKind) => {
      let completionItem = new vscode.CompletionItem(label);
      completionItem.kind = kind;
      return completionItem;
    }
    provideCompletionItems(textDocument, position, bigquery)
      .then(result => {
        assert.deepStrictEqual(result, [
          makeCompletionItem('field1.nested1', vscode.CompletionItemKind.Field),
          makeCompletionItem('field1.nested2', vscode.CompletionItemKind.Field),
          makeCompletionItem('field2.nested3', vscode.CompletionItemKind.Field),
          makeCompletionItem('field2.nested4', vscode.CompletionItemKind.Field),
        ]);
        done();
      });
  });
});
