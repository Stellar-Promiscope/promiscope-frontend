import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { openSqliteDb } from './sqliteDb';
import type { Migration } from './sqliteMigrations';

export type MilestoneStatus = 'planned' | 'in_progress' | 'completed';

export interface ProjectSummary {
  id: string;
  slug: string;
  title: string;
  organization: string;
  location: string;
  category: string;
  summary: string;
  commitment: string;
  firstMilestoneTitle: string | null;
  createdAt: string;
  status: 'active' | 'completed';
  progress: number;
  milestoneCount: number;
  completedMilestones: number;
  updateCount: number;
}

export interface ProjectRecord {
  id: string;
  slug: string;
  title: string;
  organization: string;
  location: string;
  category: string;
  summary: string;
  commitment: string;
  ownerWallet: string;
  createdAt: string;
  status: 'active' | 'completed';
  progress: number;
  milestones: {
    id: string;
    title: string;
    detail: string;
    status: MilestoneStatus;
  }[];
  updates: {
    id: string;
    authorWallet: string;
    body: string;
    evidenceUrl: string | null;
    createdAt: string;
    responses: {
      id: string;
      authorWallet: string;
      body: string;
      createdAt: string;
    }[];
  }[];
}

interface ProjectRow {
  id: string;
  slug: string;
  title: string;
  organization: string;
  location: string;
  category: string;
  summary: string;
  commitment: string;
  owner_wallet: string;
  created_at: number;
  status: 'active' | 'completed';
}
interface MilestoneRow {
  id: string;
  title: string;
  detail: string;
  status: MilestoneStatus;
}
interface UpdateRow {
  id: string;
  author_wallet: string;
  body: string;
  evidence_url: string | null;
  created_at: number;
}
interface ResponseRow {
  id: string;
  author_wallet: string;
  body: string;
  created_at: number;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'project accountability records',
    up(db) {
      db.exec(`
      CREATE TABLE IF NOT EXISTS accountability_projects (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        organization TEXT NOT NULL,
        location TEXT NOT NULL,
        category TEXT NOT NULL,
        summary TEXT NOT NULL,
        commitment TEXT NOT NULL,
        owner_wallet TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed'))
      );
      CREATE INDEX IF NOT EXISTS idx_accountability_projects_created
        ON accountability_projects(created_at DESC);
      CREATE TABLE IF NOT EXISTS accountability_milestones (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES accountability_projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'planned'
          CHECK (status IN ('planned', 'in_progress', 'completed')),
        position INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_accountability_milestones_project
        ON accountability_milestones(project_id, position);
      CREATE TABLE IF NOT EXISTS accountability_updates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES accountability_projects(id) ON DELETE CASCADE,
        author_wallet TEXT NOT NULL,
        body TEXT NOT NULL,
        evidence_url TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_accountability_updates_project
        ON accountability_updates(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS accountability_responses (
        id TEXT PRIMARY KEY,
        update_id TEXT NOT NULL REFERENCES accountability_updates(id) ON DELETE CASCADE,
        author_wallet TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_accountability_responses_update
        ON accountability_responses(update_id, created_at);
    `);
    },
  },
];

export class ProjectRecordStore {
  private static instance: ProjectRecordStore | null = null;
  private readonly db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
    this.db.pragma('foreign_keys = ON');
  }

  static getInstance() {
    if (!this.instance) {
      this.instance = new ProjectRecordStore(
        openSqliteDb(
          'project-records.db',
          'PROJECT_RECORDS_DB_PATH',
          migrations,
        ),
      );
    }
    return this.instance;
  }

  list(): ProjectSummary[] {
    const projects = this.db
      .prepare(
        `SELECT p.*,
      (SELECT COUNT(*) FROM accountability_milestones m WHERE m.project_id = p.id) AS milestone_count,
      (SELECT COUNT(*) FROM accountability_milestones m WHERE m.project_id = p.id AND m.status = 'completed') AS completed_milestones,
      (SELECT COUNT(*) FROM accountability_updates u WHERE u.project_id = p.id) AS update_count,
      (SELECT m.title FROM accountability_milestones m WHERE m.project_id = p.id ORDER BY m.position LIMIT 1) AS first_milestone_title
      FROM accountability_projects p ORDER BY p.created_at DESC LIMIT 100`,
      )
      .all() as (ProjectRow & {
      milestone_count: number;
      completed_milestones: number;
      update_count: number;
      first_milestone_title: string | null;
    })[];
    return projects.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      organization: row.organization,
      location: row.location,
      category: row.category,
      summary: row.summary,
      commitment: row.commitment,
      firstMilestoneTitle: row.first_milestone_title,
      createdAt: new Date(row.created_at).toISOString(),
      status: row.status,
      progress: row.milestone_count
        ? Math.round((row.completed_milestones / row.milestone_count) * 100)
        : 0,
      milestoneCount: row.milestone_count,
      completedMilestones: row.completed_milestones,
      updateCount: row.update_count,
    }));
  }

  get(slug: string): ProjectRecord | null {
    const row = this.db
      .prepare('SELECT * FROM accountability_projects WHERE slug = ?')
      .get(slug) as ProjectRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  create(input: {
    title: string;
    organization: string;
    location: string;
    category: string;
    summary: string;
    commitment: string;
    ownerWallet: string;
    milestones: { title: string; detail: string }[];
  }): ProjectRecord {
    const id = randomUUID();
    const base =
      input.title
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 54) || 'community-project';
    const slug = `${base}-${id.slice(0, 8)}`;
    const now = Date.now();
    const create = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO accountability_projects
        (id, slug, title, organization, location, category, summary, commitment, owner_wallet, created_at)
        VALUES (@id, @slug, @title, @organization, @location, @category, @summary, @commitment, @ownerWallet, @now)`,
        )
        .run({
          id,
          slug,
          title: input.title,
          organization: input.organization,
          location: input.location,
          category: input.category,
          summary: input.summary,
          commitment: input.commitment,
          ownerWallet: input.ownerWallet,
          now,
        });
      const insertMilestone = this.db
        .prepare(`INSERT INTO accountability_milestones
        (id, project_id, title, detail, status, position)
        VALUES (@id, @projectId, @title, @detail, 'planned', @position)`);
      input.milestones.forEach((milestone, position) =>
        insertMilestone.run({
          id: randomUUID(),
          projectId: id,
          ...milestone,
          position,
        }),
      );
    });
    create();
    return this.get(slug)!;
  }

  addUpdate(
    slug: string,
    wallet: string,
    body: string,
    evidenceUrl: string | null,
  ) {
    const project = this.db
      .prepare(
        'SELECT id FROM accountability_projects WHERE slug = ? AND owner_wallet = ?',
      )
      .get(slug, wallet) as { id: string } | undefined;
    if (!project) return null;
    this.db
      .prepare(
        `INSERT INTO accountability_updates
      (id, project_id, author_wallet, body, evidence_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), project.id, wallet, body, evidenceUrl, Date.now());
    return this.get(slug);
  }

  updateMilestone(
    slug: string,
    wallet: string,
    milestoneId: string,
    status: MilestoneStatus,
  ) {
    const project = this.db
      .prepare(
        'SELECT id FROM accountability_projects WHERE slug = ? AND owner_wallet = ?',
      )
      .get(slug, wallet) as { id: string } | undefined;
    if (!project) return null;
    const result = this.db
      .prepare(
        `UPDATE accountability_milestones
      SET status = ? WHERE id = ? AND project_id = ?`,
      )
      .run(status, milestoneId, project.id);
    if (!result.changes) return null;
    const remaining = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM accountability_milestones
      WHERE project_id = ? AND status <> 'completed'`,
      )
      .get(project.id) as { count: number };
    this.db
      .prepare('UPDATE accountability_projects SET status = ? WHERE id = ?')
      .run(remaining.count === 0 ? 'completed' : 'active', project.id);
    return this.get(slug);
  }

  addResponse(slug: string, wallet: string, updateId: string, body: string) {
    const update = this.db
      .prepare(
        `SELECT u.id FROM accountability_updates u
      JOIN accountability_projects p ON p.id = u.project_id
      WHERE p.slug = ? AND u.id = ?`,
      )
      .get(slug, updateId) as { id: string } | undefined;
    if (!update) return null;
    this.db
      .prepare(
        `INSERT INTO accountability_responses
      (id, update_id, author_wallet, body, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), update.id, wallet, body, Date.now());
    return this.get(slug);
  }

  private hydrate(row: ProjectRow): ProjectRecord {
    const milestoneRows = this.db
      .prepare(
        `SELECT id, title, detail, status
      FROM accountability_milestones WHERE project_id = ? ORDER BY position`,
      )
      .all(row.id) as MilestoneRow[];
    const updates = this.db
      .prepare(
        `SELECT id, author_wallet, body, evidence_url, created_at
      FROM accountability_updates WHERE project_id = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .all(row.id) as UpdateRow[];
    const doneCount = milestoneRows.filter(
      (m) => m.status === 'completed',
    ).length;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      organization: row.organization,
      location: row.location,
      category: row.category,
      summary: row.summary,
      commitment: row.commitment,
      ownerWallet: row.owner_wallet,
      createdAt: new Date(row.created_at).toISOString(),
      status: row.status,
      progress: milestoneRows.length
        ? Math.round((doneCount / milestoneRows.length) * 100)
        : 0,
      milestones: milestoneRows,
      updates: updates.map((update) => ({
        id: update.id,
        authorWallet: update.author_wallet,
        body: update.body,
        evidenceUrl: update.evidence_url,
        createdAt: new Date(update.created_at).toISOString(),
        responses: (
          this.db
            .prepare(
              `SELECT id, author_wallet, body, created_at
          FROM accountability_responses WHERE update_id = ? ORDER BY created_at LIMIT 100`,
            )
            .all(update.id) as ResponseRow[]
        ).map((response) => ({
          id: response.id,
          authorWallet: response.author_wallet,
          body: response.body,
          createdAt: new Date(response.created_at).toISOString(),
        })),
      })),
    };
  }
}
