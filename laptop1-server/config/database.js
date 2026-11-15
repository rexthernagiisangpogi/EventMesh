const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const Database = require('better-sqlite3');

const TIMESTAMP_KEY = '$eventmeshTimestampMs';

class Timestamp {
  constructor(milliseconds) {
    this.milliseconds = milliseconds;
  }

  static now() {
    return Timestamp.fromDate(new Date());
  }

  static fromDate(date) {
    return new Timestamp(date.getTime());
  }

  toDate() {
    return new Date(this.milliseconds);
  }

  toMillis() {
    return this.milliseconds;
  }
}

function encode(value) {
  return JSON.stringify(value, (_key, item) => (
    item instanceof Timestamp ? { [TIMESTAMP_KEY]: item.toMillis() } : item
  ));
}

function decode(value) {
  return JSON.parse(value, (_key, item) => (
    item && typeof item === 'object' &&
    Object.keys(item).length === 1 &&
    Number.isFinite(item[TIMESTAMP_KEY])
      ? new Timestamp(item[TIMESTAMP_KEY])
      : item
  ));
}

function compareValues(left, right) {
  const normalize = (value) => {
    if (value instanceof Timestamp) return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return value;
  };
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return a < b ? -1 : 1;
}

class DocumentSnapshot {
  constructor(ref, serializedData) {
    this.ref = ref;
    this.id = ref.id;
    this._serializedData = serializedData;
    this.exists = serializedData !== undefined;
  }

  data() {
    return this.exists ? decode(this._serializedData) : undefined;
  }
}

class QuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }
}

class DocumentReference {
  constructor(database, collection, id) {
    this.database = database;
    this.collectionName = collection;
    this.id = id;
  }

  get() {
    return this.database.enqueue(() => this.database.readDocument(this));
  }

  set(data) {
    return this.database.enqueue(() => this.database.writeDocument(this, data));
  }

  update(data) {
    return this.database.enqueue(() => this.database.updateDocument(this, data));
  }

  delete() {
    return this.database.enqueue(() => this.database.deleteDocument(this));
  }
}

class Query {
  constructor(database, collection, filters = [], sort = null, maxResults = null) {
    this.database = database;
    this.collectionName = collection;
    this.filters = filters;
    this.sort = sort;
    this.maxResults = maxResults;
  }

  where(field, operator, value) {
    if (!['==', '<', '<=', '>', '>='].includes(operator)) {
      throw new TypeError(`Unsupported query operator: ${operator}`);
    }
    return new Query(
      this.database,
      this.collectionName,
      [...this.filters, { field, operator, value }],
      this.sort,
      this.maxResults,
    );
  }

  orderBy(field, direction = 'asc') {
    const normalizedDirection = direction.toLowerCase();
    if (!['asc', 'desc'].includes(normalizedDirection)) {
      throw new TypeError(`Unsupported sort direction: ${direction}`);
    }
    return new Query(
      this.database,
      this.collectionName,
      this.filters,
      { field, direction: normalizedDirection },
      this.maxResults,
    );
  }

  limit(count) {
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError('Query limit must be a non-negative integer.');
    }
    return new Query(
      this.database,
      this.collectionName,
      this.filters,
      this.sort,
      count,
    );
  }

  get() {
    return this.database.enqueue(() => {
      let docs = this.database.readCollection(this.collectionName);
      docs = docs.filter((doc) => this.filters.every(({ field, operator, value }) => {
        const comparison = compareValues(doc.data()[field], value);
        if (operator === '==') return comparison === 0;
        if (operator === '<') return comparison < 0;
        if (operator === '<=') return comparison <= 0;
        if (operator === '>') return comparison > 0;
        return comparison >= 0;
      }));

      if (this.sort) {
        const { field, direction } = this.sort;
        docs.sort((left, right) => {
          const result = compareValues(left.data()[field], right.data()[field]);
          return direction === 'desc' ? -result : result;
        });
      }

      if (this.maxResults !== null) docs = docs.slice(0, this.maxResults);
      return new QuerySnapshot(docs);
    });
  }
}

class CollectionReference extends Query {
  doc(id = randomUUID()) {
    if (typeof id !== 'string' || id.length === 0 || id.includes('/')) {
      throw new TypeError('Document IDs must be non-empty strings without "/".');
    }
    return new DocumentReference(this.database, this.collectionName, id);
  }
}

class LocalDatabase {
  constructor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.connection = new Database(filePath);
    this.connection.pragma('journal_mode = WAL');
    this.connection.pragma('busy_timeout = 5000');
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      )
    `);
    this.writeQueue = Promise.resolve();
    this.readStatement = this.connection.prepare(
      'SELECT data FROM documents WHERE collection = ? AND id = ?',
    );
    this.collectionStatement = this.connection.prepare(
      'SELECT id, data FROM documents WHERE collection = ?',
    );
    this.setStatement = this.connection.prepare(
      'INSERT INTO documents (collection, id, data) VALUES (?, ?, ?) ' +
      'ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data',
    );
    this.deleteStatement = this.connection.prepare(
      'DELETE FROM documents WHERE collection = ? AND id = ?',
    );
  }

  enqueue(operation) {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  collection(name) {
    if (typeof name !== 'string' || name.length === 0 || name.includes('/')) {
      throw new TypeError('Collection names must be non-empty strings without "/".');
    }
    return new CollectionReference(this, name);
  }

  readDocument(ref) {
    const row = this.readStatement.get(ref.collectionName, ref.id);
    return new DocumentSnapshot(ref, row?.data);
  }

  readCollection(name) {
    return this.collectionStatement.all(name).map((row) => (
      new DocumentSnapshot(new DocumentReference(this, name, row.id), row.data)
    ));
  }

  writeDocument(ref, data) {
    this.setStatement.run(ref.collectionName, ref.id, encode(data));
  }

  updateDocument(ref, data) {
    const current = this.readStatement.get(ref.collectionName, ref.id);
    if (!current) throw new Error(`Document ${ref.collectionName}/${ref.id} does not exist.`);
    this.writeDocument(ref, { ...decode(current.data), ...data });
  }

  deleteDocument(ref) {
    this.deleteStatement.run(ref.collectionName, ref.id);
  }

  batch() {
    const operations = [];
    return {
      set: (ref, data) => operations.push(() => this.writeDocument(ref, data)),
      update: (ref, data) => operations.push(() => this.updateDocument(ref, data)),
      delete: (ref) => operations.push(() => this.deleteDocument(ref)),
      commit: () => this.enqueue(() => {
        const commit = this.connection.transaction(() => operations.forEach((operation) => operation()));
        commit();
      }),
    };
  }

  runTransaction(callback) {
    return this.enqueue(async () => {
      this.connection.exec('BEGIN IMMEDIATE');
      const transaction = {
        get: async (ref) => this.readDocument(ref),
        set: (ref, data) => this.writeDocument(ref, data),
        update: (ref, data) => this.updateDocument(ref, data),
        delete: (ref) => this.deleteDocument(ref),
      };

      try {
        const result = await callback(transaction);
        this.connection.exec('COMMIT');
        return result;
      } catch (error) {
        this.connection.exec('ROLLBACK');
        throw error;
      }
    });
  }

  close() {
    this.connection.close();
  }
}

const dataDirectory = path.resolve(
  process.env.EVENTMESH_DATA_DIR || path.join(__dirname, '..', 'data'),
);
const db = new LocalDatabase(path.join(dataDirectory, 'eventmesh.sqlite'));
db.Timestamp = Timestamp;

module.exports = db;
