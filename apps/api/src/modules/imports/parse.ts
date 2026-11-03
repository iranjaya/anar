import type { Hash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { AppError } from "@anar/domain/errors";
import type { CsvProfile, Delimiter, Option } from "@anar/domain/imports";
import { CsvError, parse as csvParse } from "csv-parse";
import dates from "../../lib/dates.js";
import encoding from "./encoding.js";
import mapping from "./mapping.js";
import type { EncodingResult, ReadControl } from "./types.js";

const headSize = 64 * 1024;
const sampleRows = 20;
const dropdownMax = 12;
const delimiters: Delimiter[] = [",", "\t", ";", "|"];
const number = /^-?\d+(?:\.\d+)?$/;

type OpenFile = {
  encoding: EncodingResult;
  delimiter: Delimiter;
  records: AsyncGenerator<string[]>;
};
type ColumnScan = { values: Set<string>; samples: string[] };

const parse = {
  // Ties go to the earlier delimiter in comma, tab, semicolon, pipe order.
  detectDelimiter(text: string): Delimiter {
    const counts = new Map(delimiters.map((d) => [d, 0]));
    let quoted = false;
    let records = 0;
    for (let i = 0; i < text.length && records < 5; i++) {
      const char = text[i];
      if (char === '"') quoted = !quoted;
      else if (quoted) continue;
      else if (char === "\n") records++;
      else if (counts.has(char as Delimiter))
        counts.set(char as Delimiter, (counts.get(char as Delimiter) ?? 0) + 1);
    }
    return delimiters.reduce((best, d) =>
      (counts.get(d) ?? 0) > (counts.get(best) ?? 0) ? d : best,
    );
  },
  // One read of the file: the first 64 KiB pick the encoding and delimiter, then the rows follow.
  async open(
    path: string,
    control: ReadControl,
    hash?: Hash,
  ): Promise<OpenFile> {
    const rest: AsyncIterator<Buffer> = parse._hashed(
      createReadStream(path, { signal: control.signal }),
      hash,
    );
    const parts: Buffer[] = [];
    for (let size = 0; size < headSize; ) {
      const next = await rest.next();
      if (next.done) break;
      parts.push(next.value);
      size += next.value.length;
    }
    const head = Buffer.concat(parts);
    const detected = encoding.detectEncoding(head);
    const headText = new TextDecoder(detected.encoding).decode(
      head.subarray(detected.bomLength, headSize),
      { stream: true },
    );
    const delimiter = parse.detectDelimiter(headText);
    return {
      encoding: detected,
      delimiter,
      records: parse._records(parse._text(head, rest, detected), delimiter),
    };
  },
  async profileCsv(path: string, control: ReadControl): Promise<CsvProfile> {
    const file = await parse.open(path, control);
    let columns: CsvProfile["columns"] | null = null;
    const sample: string[][] = [];
    const scans: ColumnScan[] = [];
    let rowCount = 0;
    let dateColumn = -1;
    let from: Date | null = null;
    let to: Date | null = null;
    for await (const record of file.records) {
      if (!columns) {
        if (!parse._isHeader(record)) continue;
        columns = mapping.headerColumns(record);
        for (const _ of columns) scans.push({ values: new Set(), samples: [] });
        dateColumn = columns.findIndex(
          (c) => mapping.synonymFor(c.normalized) === "system:lead_date",
        );
        continue;
      }
      rowCount++;
      const row = columns.map((_, i) => record[i] ?? "");
      if (sample.length < sampleRows) sample.push(row);
      row.forEach((cell, i) => {
        const value = cell.trim();
        if (!value) return;
        const scan = scans[i];
        if (scan.values.size <= dropdownMax) scan.values.add(value);
        if (rowCount <= sampleRows) scan.samples.push(value);
      });
      const date =
        dateColumn < 0 ? null : dates.parseOffsetDate(row[dateColumn].trim());
      if (date) {
        if (!from || date < from) from = date;
        if (!to || date > to) to = date;
      }
    }
    if (!columns)
      throw new AppError("validation", "The file has no header row");
    if (rowCount === 0)
      throw new AppError("validation", "The file has no rows");
    return {
      encoding: file.encoding.encoding,
      delimiter: file.delimiter,
      columns,
      sample,
      rowCount,
      dateRange: from && to ? { from, to } : null,
      warning: file.encoding.warning,
      columnKinds: columns.map((column, i) => ({
        header: column.header,
        ...parse._kind(scans[i]),
      })),
    };
  },
  // The same rows profileCsv counted: everything after the header record.
  async *dataRows(
    path: string,
    control: ReadControl,
    hash?: Hash,
  ): AsyncGenerator<string[]> {
    let header = false;
    for await (const record of (await parse.open(path, control, hash))
      .records) {
      if (header) yield record;
      else header = parse._isHeader(record);
    }
  },
  _isHeader(record: string[]): boolean {
    return record.filter((cell) => cell.trim()).length >= 2;
  },
  _kind(scan: ColumnScan): {
    type: CsvProfile["columnKinds"][number]["type"];
    options: Option[];
  } {
    const { samples, values } = scan;
    if (samples.length > 0 && samples.every((v) => number.test(v)))
      return { type: "number", options: [] };
    if (samples.length > 0 && samples.every((v) => dates.looksLikeDate(v)))
      return { type: "date", options: [] };
    if (values.size > 0 && values.size <= dropdownMax)
      return {
        type: "dropdown",
        options: [...values].map((value) => ({
          value,
          label: mapping.guessLabel(value),
        })),
      };
    return { type: "text", options: [] };
  },
  async *_records(
    text: AsyncGenerator<string>,
    delimiter: Delimiter,
  ): AsyncGenerator<string[]> {
    const parser = csvParse({
      delimiter,
      bom: false,
      relax_column_count: true,
      skip_empty_lines: true,
      skip_records_with_empty_values: true,
    });
    const source = Readable.from(text);
    source.on("error", (error) => parser.destroy(error));
    source.pipe(parser);
    try {
      for await (const record of parser) yield record as string[];
    } catch (error) {
      if (error instanceof CsvError)
        throw new AppError("validation", "The file has a broken quote or row");
      throw error;
    } finally {
      source.destroy();
    }
  },
  async *_hashed(
    source: AsyncIterable<Buffer>,
    hash: Hash | undefined,
  ): AsyncGenerator<Buffer> {
    for await (const chunk of source) {
      hash?.update(chunk);
      yield chunk;
    }
  },
  async *_text(
    head: Buffer,
    rest: AsyncIterator<Buffer>,
    detected: EncodingResult,
  ): AsyncGenerator<string> {
    const decoder = new TextDecoder(detected.encoding);
    const decode = (bytes: Uint8Array) => {
      const text = decoder.decode(bytes, { stream: true });
      if (text.includes("\0"))
        throw new AppError("validation", "The file is not a text file");
      return text;
    };
    yield decode(head.subarray(detected.bomLength));
    for await (const chunk of { [Symbol.asyncIterator]: () => rest })
      yield decode(chunk);
    yield decoder.decode();
  },
};
export default parse;
