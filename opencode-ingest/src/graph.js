import neo4j from 'neo4j-driver';

/**
 * Neo4j graph layer for relationship mapping.
 * Connects people → companies, people → skills, people → locations.
 *
 * Expects NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD env vars.
 * Falls back to bolt://localhost:7687 with neo4j/neo4j.
 */
export class Graph {
  constructor() {
    this.uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    this.user = process.env.NEO4J_USER || 'neo4j';
    this.password = process.env.NEO4J_PASSWORD || 'neo4j';
    this.driver = null;
  }

  async connect() {
    try {
      this.driver = neo4j.driver(this.uri, neo4j.auth.basic(this.user, this.password));
      await this.driver.verifyConnectivity();
      console.log('[graph] Connected to Neo4j');

      // Create constraints/indexes
      const session = this.driver.session();
      try {
        await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (p:Person) REQUIRE p.profileUrl IS UNIQUE');
        await session.run('CREATE CONSTRAINT IF NOT EXISTS FOR (c:Company) REQUIRE c.name IS UNIQUE');
        await session.run('CREATE INDEX IF NOT EXISTS FOR (p:Person) ON (p.name)');
        await session.run('CREATE INDEX IF NOT EXISTS FOR (p:Person) ON (p.seniority)');
      } finally {
        await session.close();
      }
      return true;
    } catch (err) {
      console.log(`[graph] Neo4j not available (${err.message}) — skipping graph sync`);
      this.driver = null;
      return false;
    }
  }

  async ingestDev(dev) {
    if (!this.driver) return;
    const session = this.driver.session();
    try {
      await session.run(`
        MERGE (p:Person {profileUrl: $profileUrl})
        SET p.name = $name,
            p.title = $title,
            p.seniority = $seniority,
            p.location = $location,
            p.salary = $salary,
            p.contact = $contact,
            p.updatedAt = datetime()
        WITH p
        MERGE (c:Company {name: $company})
        MERGE (p)-[:WORKS_AT {title: $title, since: $since}]->(c)
        WITH p
        UNWIND $skills AS skillName
        MERGE (s:Skill {name: skillName})
        MERGE (p)-[:HAS_SKILL]->(s)
      `, {
        profileUrl: dev.profileUrl || dev.name,
        name: dev.name || '',
        title: dev.title || '',
        seniority: dev.seniority || '',
        location: dev.location || 'Argentina',
        salary: dev.salary || '',
        contact: dev.contact || '',
        company: dev.company || 'Unknown',
        since: dev.since || '',
        skills: (dev.skills || '').split(',').map(s => s.trim()).filter(Boolean),
      });
    } finally {
      await session.close();
    }
  }

  async ingestBatch(devs) {
    for (const dev of devs) {
      await this.ingestDev(dev);
    }
    if (this.driver) {
      console.log(`[graph] Synced ${devs.length} devs to Neo4j`);
    }
  }

  async close() {
    if (this.driver) await this.driver.close();
  }
}
