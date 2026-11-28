import fs from 'fs';
import path from 'path';

const firebaseConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = fs.existsSync(firebaseConfigPath)
  ? JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'))
  : {};

const PROJECT_ID = String(firebaseConfig.projectId || '');
const DATABASE_ID = String(firebaseConfig.firestoreDatabaseId || '(default)');

function getBaseDocumentsUrl(): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(PROJECT_ID)}/databases/${encodeURIComponent(DATABASE_ID)}/documents`;
}

function getRunQueryUrl(): string {
  return `${getBaseDocumentsUrl()}:runQuery`;
}

export interface FirestoreRestTimestamp {
  __serverTimestamp?: true;
}

export function serverTimestampSentinel(): FirestoreRestTimestamp {
  return { __serverTimestamp: true };
}

type FsValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

export function toFirestoreValue(val: unknown): FsValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(val)) {
      return { timestampValue: val };
    }
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.filter((item) => item !== undefined).map((item) => toFirestoreValue(item)),
      },
    };
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (obj.__serverTimestamp) {
      return { timestampValue: new Date().toISOString() };
    }
    const fields: Record<string, FsValue> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function fromFirestoreValue(val: FsValue | undefined): any {
  if (!val || typeof val !== 'object') return null;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return String(val.timestampValue);
  if ('stringValue' in val) return String(val.stringValue);
  if ('arrayValue' in val) {
    const items = val.arrayValue?.values || [];
    return items.map((item) => fromFirestoreValue(item));
  }
  if ('mapValue' in val) {
    const out: Record<string, any> = {};
    const fields = val.mapValue?.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

export function decodeDocument(docJson: any): Record<string, any> | null {
  if (!docJson || typeof docJson !== 'object' || !docJson.name) return null;
  const fullPath = String(docJson.name);
  const parts = fullPath.split('/');
  const id = parts[parts.length - 1] || '';
  const data = fromFirestoreValue({ mapValue: { fields: docJson.fields || {} } });
  return { id, ...data };
}

function authHeaders(idToken?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  return headers;
}

export function isFirestoreConfigured(): boolean {
  return Boolean(PROJECT_ID && DATABASE_ID);
}

export async function fsGetDoc(docPath: string, idToken: string): Promise<Record<string, any> | null> {
  if (!isFirestoreConfigured() || !idToken) return null;
  const cleanPath = docPath.replace(/^\/+/, '');
  const res = await fetch(`${getBaseDocumentsUrl()}/${cleanPath}`, {
    method: 'GET',
    headers: authHeaders(idToken),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore GET ${cleanPath} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return decodeDocument(json);
}

export async function fsSetDoc(
  docPath: string,
  data: Record<string, unknown>,
  idToken: string,
  options: { mergeFields?: string[]; preconditionExists?: boolean } = {}
): Promise<Record<string, any>> {
  if (!isFirestoreConfigured() || !idToken) {
    throw new Error('Firestore authentication context missing.');
  }
  const cleanPath = docPath.replace(/^\/+/, '');
  const fields: Record<string, FsValue> = {};
  const transforms: Array<{ fieldPath: string; setToServerValue: 'REQUEST_TIME' }> = [];

  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && (v as any).__serverTimestamp === true) {
      transforms.push({ fieldPath: k, setToServerValue: 'REQUEST_TIME' });
    } else {
      fields[k] = toFirestoreValue(v);
    }
  }

  const fullDocName = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${cleanPath}`;
  if (transforms.length > 0) {
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(PROJECT_ID)}/databases/${encodeURIComponent(DATABASE_ID)}/documents:commit`;
    const writeOp: Record<string, any> = {
      update: {
        name: fullDocName,
        fields,
      },
      updateTransforms: transforms,
    };
    if (Array.isArray(options.mergeFields) && options.mergeFields.length > 0) {
      writeOp.updateMask = {
        fieldPaths: options.mergeFields.filter((f) => !transforms.some((t) => t.fieldPath === f)),
      };
    }
    if (options.preconditionExists !== undefined) {
      writeOp.currentDocument = { exists: options.preconditionExists };
    }
    const res = await fetch(commitUrl, {
      method: 'POST',
      headers: authHeaders(idToken),
      body: JSON.stringify({ writes: [writeOp] }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Firestore COMMIT ${cleanPath} failed (${res.status}): ${text.slice(0, 240)}`);
    }
    const nowIso = new Date().toISOString();
    const out: Record<string, any> = { id: cleanPath.split('/').pop() || '', ...data };
    for (const t of transforms) out[t.fieldPath] = nowIso;
    return out;
  }

  const params = new URLSearchParams();
  if (Array.isArray(options.mergeFields) && options.mergeFields.length > 0) {
    for (const f of options.mergeFields) {
      params.append('updateMask.fieldPaths', f);
    }
  }
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${getBaseDocumentsUrl()}/${cleanPath}${qs}`, {
    method: 'PATCH',
    headers: authHeaders(idToken),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore WRITE ${cleanPath} failed (${res.status}): ${text.slice(0, 240)}`);
  }
  const json = await res.json();
  return decodeDocument(json) || { ...data };
}

export interface FsBatchWriteOp {
  type: 'set' | 'patch' | 'delete';
  docPath: string;
  data?: Record<string, unknown>;
  mergeFields?: string[];
  preconditionExists?: boolean;
}

export async function fsPatchDoc(
  docPath: string,
  patch: Record<string, unknown>,
  idToken: string
): Promise<Record<string, any>> {
  const mergeFields = Object.keys(patch).filter((k) => patch[k] !== undefined);
  return fsSetDoc(docPath, patch, idToken, { mergeFields, preconditionExists: true });
}

export async function fsCommitWrites(ops: FsBatchWriteOp[], idToken: string): Promise<void> {
  if (!isFirestoreConfigured() || !idToken) {
    throw new Error('Firestore authentication context missing.');
  }
  if (!ops.length) return;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(PROJECT_ID)}/databases/${encodeURIComponent(DATABASE_ID)}/documents:commit`;
  const writes = ops.map((op) => {
    const cleanPath = op.docPath.replace(/^\/+/, '');
    const fullDocName = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${cleanPath}`;
    if (op.type === 'delete') {
      return { delete: fullDocName };
    }
    const data = op.data || {};
    const fields: Record<string, FsValue> = {};
    const transforms: Array<{ fieldPath: string; setToServerValue: 'REQUEST_TIME' }> = [];
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (v && typeof v === 'object' && !Array.isArray(v) && (v as any).__serverTimestamp === true) {
        transforms.push({ fieldPath: k, setToServerValue: 'REQUEST_TIME' });
      } else {
        fields[k] = toFirestoreValue(v);
      }
    }
    const writeOp: Record<string, any> = {
      update: { name: fullDocName, fields },
      ...(transforms.length > 0 ? { updateTransforms: transforms } : {}),
    };
    if (op.type === 'patch' || (Array.isArray(op.mergeFields) && op.mergeFields.length > 0)) {
      const maskFields =
        op.mergeFields && op.mergeFields.length > 0
          ? op.mergeFields
          : Object.keys(data).filter((k) => data[k] !== undefined);
      writeOp.updateMask = {
        fieldPaths: maskFields.filter((f) => !transforms.some((t) => t.fieldPath === f)),
      };
    }
    if (op.preconditionExists !== undefined) {
      writeOp.currentDocument = { exists: op.preconditionExists };
    }
    return writeOp;
  });

  const res = await fetch(commitUrl, {
    method: 'POST',
    headers: authHeaders(idToken),
    body: JSON.stringify({ writes }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore BATCH COMMIT failed (${res.status}): ${text.slice(0, 240)}`);
  }
}

export async function fsDeleteDoc(docPath: string, idToken: string): Promise<boolean> {
  if (!isFirestoreConfigured() || !idToken) return false;
  const cleanPath = docPath.replace(/^\/+/, '');
  const res = await fetch(`${getBaseDocumentsUrl()}/${cleanPath}`, {
    method: 'DELETE',
    headers: authHeaders(idToken),
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore DELETE ${cleanPath} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return true;
}

export interface FsWhereFilter {
  field: string;
  op: 'EQUAL' | 'NOT_EQUAL' | 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL' | 'LESS_THAN' | 'LESS_THAN_OR_EQUAL' | 'ARRAY_CONTAINS' | 'IN';
  value: unknown;
}

export async function fsQueryCollection(
  collectionId: string,
  idToken: string,
  opts: {
    parentPath?: string;
    where?: FsWhereFilter[];
    orderBy?: { field: string; direction?: 'ASCENDING' | 'DESCENDING' };
    limit?: number;
  } = {}
): Promise<Array<Record<string, any>>> {
  if (!isFirestoreConfigured() || !idToken) return [];
  const structuredQuery: Record<string, any> = {
    from: [{ collectionId }],
    limit: Math.min(200, Math.max(1, opts.limit || 50)),
  };
  if (opts.where && opts.where.length > 0) {
    const filters = opts.where.map((w) => ({
      fieldFilter: {
        field: { fieldPath: w.field },
        op: w.op,
        value: toFirestoreValue(w.value),
      },
    }));
    structuredQuery.where =
      filters.length === 1
        ? filters[0]
        : { compositeFilter: { op: 'AND', filters } };
  }
  if (opts.orderBy) {
    structuredQuery.orderBy = [
      {
        field: { fieldPath: opts.orderBy.field },
        direction: opts.orderBy.direction || 'DESCENDING',
      },
    ];
  }
  const url = opts.parentPath
    ? `${getBaseDocumentsUrl()}/${opts.parentPath.replace(/^\/+/, '')}:runQuery`
    : getRunQueryUrl();

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(idToken),
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore QUERY ${collectionId} failed (${res.status}): ${text.slice(0, 240)}`);
  }
  const rows = (await res.json()) as any[];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && row.document)
    .map((row) => decodeDocument(row.document))
    .filter(Boolean) as Array<Record<string, any>>;
}

export async function fsListCollection(
  collectionPath: string,
  idToken: string,
  pageSize = 50
): Promise<Array<Record<string, any>>> {
  if (!isFirestoreConfigured() || !idToken) return [];
  const clean = collectionPath.replace(/^\/+/, '');
  const res = await fetch(`${getBaseDocumentsUrl()}/${clean}?pageSize=${Math.min(200, Math.max(1, pageSize))}`, {
    method: 'GET',
    headers: authHeaders(idToken),
  });
  if (res.status === 404) return [];
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore LIST ${clean} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json: any = await res.json();
  const docs = Array.isArray(json.documents) ? json.documents : [];
  return docs.map((d: any) => decodeDocument(d)).filter(Boolean) as Array<Record<string, any>>;
}
