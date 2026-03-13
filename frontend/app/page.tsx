'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const ROWS = 10;
const COLS = 10;

type CellGrid = Record<string, string>; // key: "row-col", value: display string

// ---------------------------------------------------------------------------
// Formula evaluation
// ---------------------------------------------------------------------------

type Token =
  | { type: 'num'; value: number }
  | { type: 'cell'; row: number; col: number }
  | { type: 'op'; value: string };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ') {
      i++;
      continue;
    }
    // Cell reference: letter A-J followed by digit(s) 1-10
    if (/[A-Ja-j]/.test(ch) && i + 1 < expr.length && /[0-9]/.test(expr[i + 1])) {
      const col = ch.toUpperCase().charCodeAt(0) - 65;
      i++;
      let rowStr = '';
      while (i < expr.length && /[0-9]/.test(expr[i])) {
        rowStr += expr[i++];
      }
      tokens.push({ type: 'cell', row: parseInt(rowStr, 10) - 1, col });
      continue;
    }
    // Number literal
    if (/[0-9]/.test(ch)) {
      let numStr = '';
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        numStr += expr[i++];
      }
      tokens.push({ type: 'num', value: parseFloat(numStr) });
      continue;
    }
    // Operator
    if (/[+\-*/]/.test(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    i++; // skip unknown characters
  }
  return tokens;
}

function resolveToken(token: Token, grid: CellGrid, cellKey: string): number {
  if (token.type === 'num') return token.value;
  if (token.type === 'cell') {
    const key = `${token.row}-${token.col}`;
    const val = grid[key] ?? '';
    if (val === '') return NaN;
    return parseFloat(val);
  }
  throw new Error('Invalid token');
}

function evaluateFormula(formula: string, grid: CellGrid, cellKey: string): number {
  const expr = formula.slice(1).trim(); // strip leading '='
  const tokens = tokenize(expr);

  if (tokens.length === 0) return 0;

  // Collect values and operators
  const values: number[] = [resolveToken(tokens[0], grid, cellKey)];
  const ops: string[] = [];

  for (let j = 1; j + 1 <= tokens.length - 1; j += 2) {
    const opTok = tokens[j];
    const valTok = tokens[j + 1];
    if (opTok.type !== 'op') break;
    ops.push(opTok.value);
    values.push(resolveToken(valTok, grid, cellKey));
  }

  // First pass: * and /
  let k = 0;
  while (k < ops.length) {
    if (ops[k] === '*' || ops[k] === '/') {
      const result =
        ops[k] === '*' ? values[k] * values[k + 1] : values[k] / values[k + 1];
      values.splice(k, 2, result);
      ops.splice(k, 1);
    } else {
      k++;
    }
  }

  // Second pass: + and -
  let result = values[0];
  for (let l = 0; l < ops.length; l++) {
    result = ops[l] === '+' ? result + values[l + 1] : result - values[l + 1];
  }

  return result;
}

function formatResult(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // Trim floating-point noise
  return String(parseFloat(value.toPrecision(10)));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SpreadsheetPage() {
  const [grid, setGrid] = useState<CellGrid>({});
  const [connectionCount, setConnectionCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Refs for synchronous access without stale closures
  const gridRef = useRef<CellGrid>({});
  const focusedCellRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001');
    wsRef.current = ws;

    ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string);

      if (msg.type === 'init') {
        const initialGrid: CellGrid = msg.grid ?? {};
        gridRef.current = initialGrid;
        setGrid(initialGrid);
        setConnectionCount(msg.connectionCount ?? 0);
      } else if (msg.type === 'cell_update') {
        const key = `${msg.row}-${msg.col}`;
        // Don't override the cell the user is currently editing
        if (focusedCellRef.current !== key) {
          const next = { ...gridRef.current, [key]: String(msg.value ?? '') };
          gridRef.current = next;
          setGrid(next);
        }
      } else if (msg.type === 'connection_count') {
        setConnectionCount(msg.count);
      }
    };

    ws.onerror = (e) => console.error('WebSocket error', e);

    return () => {
      ws.close();
    };
  }, []);

  const sendUpdate = useCallback((row: number, col: number, value: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'cell_update', row, col, value }));
    }
  }, []);

  const handleChange = useCallback((row: number, col: number, value: string) => {
    const key = `${row}-${col}`;
    const next = { ...gridRef.current, [key]: value };
    gridRef.current = next;
    setGrid(next);
  }, []);

  const handleFocus = useCallback((row: number, col: number) => {
    focusedCellRef.current = `${row}-${col}`;
  }, []);

  const handleBlur = useCallback(
    (row: number, col: number, e: React.FocusEvent<HTMLInputElement>) => {
      focusedCellRef.current = null;
      const key = `${row}-${col}`;
      // Use the actual DOM value as source of truth — handles cases where
      // onChange was not triggered (e.g. Playwright fill() with React 19).
      const rawValue = e.target.value;
      const synced = { ...gridRef.current, [key]: rawValue };
      gridRef.current = synced;

      if (rawValue.startsWith('=')) {
        try {
          const result = evaluateFormula(rawValue, gridRef.current, key);
          const resultStr = formatResult(result);
          const next = { ...gridRef.current, [key]: resultStr };
          gridRef.current = next;
          setGrid(next);
          sendUpdate(row, col, resultStr);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Formula error';
          setErrorMsg(msg);
          const next = { ...gridRef.current, [key]: '' };
          gridRef.current = next;
          setGrid(next);
          sendUpdate(row, col, '');
        }
      } else {
        setGrid(synced);
        sendUpdate(row, col, rawValue);
      }
    },
    [sendUpdate]
  );

  return (
    <div className="p-4 min-h-screen bg-white">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold text-gray-800">Realtime Spreadsheet</h1>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>Connected:</span>
          <span data-testid="connection-count" className="font-semibold text-gray-900">
            {connectionCount}
          </span>
        </div>
      </div>

      {/* Grid */}
      <div data-testid="spreadsheet-grid" className="overflow-auto border border-gray-300 inline-block">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-gray-300 px-2 py-1 bg-gray-100 w-8 text-center text-xs text-gray-500" />
              {Array.from({ length: COLS }, (_, col) => (
                <th
                  key={col}
                  className="border border-gray-300 px-2 py-1 bg-gray-100 text-center text-xs text-gray-600 font-medium min-w-[80px]"
                >
                  {String.fromCharCode(65 + col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, row) => (
              <tr key={row}>
                <td className="border border-gray-300 px-2 py-1 bg-gray-100 text-center text-xs text-gray-500 select-none">
                  {row + 1}
                </td>
                {Array.from({ length: COLS }, (_, col) => {
                  const key = `${row}-${col}`;
                  return (
                    <td
                      key={col}
                      data-testid={`cell-${row}-${col}`}
                      className="border border-gray-200 p-0"
                    >
                      <input
                        data-testid={`cell-input-${row}-${col}`}
                        className="w-full px-1 py-0.5 min-w-[80px] outline-none focus:bg-blue-50 focus:ring-1 focus:ring-blue-400 text-sm"
                        value={grid[key] ?? ''}
                        onChange={(e) => handleChange(row, col, e.target.value)}
                        onFocus={() => handleFocus(row, col)}
                        onBlur={(e) => handleBlur(row, col, e)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Error popup — only mounted when an error is active */}
      {errorMsg !== null && (
        <div
          data-testid="cell-error-dialog"
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        >
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h2 className="text-base font-semibold mb-2 text-red-600">Formula Error</h2>
            <p data-testid="cell-error-message" className="text-gray-700 text-sm mb-4">
              {errorMsg}
            </p>
            <button
              data-testid="cell-error-dismiss"
              className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 focus:outline-none"
              onClick={() => setErrorMsg(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
