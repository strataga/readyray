import type { Pool } from 'pg';

export const POSTGRES_POOL = Symbol('POSTGRES_POOL');
export type PostgresPool = Pool;
