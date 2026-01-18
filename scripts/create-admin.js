#!/usr/bin/env node
/**
 * Create Admin User Script
 *
 * Creates an admin user on container startup if ADMIN_EMAIL and ADMIN_PASSWORD are set
 */

const crypto = require('crypto');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const databaseUrl = process.env.DATABASE_URL;

  if (!email || !password) {
    console.log('ADMIN_EMAIL or ADMIN_PASSWORD not set, skipping admin creation');
    process.exit(0);
  }

  if (!databaseUrl) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: databaseUrl });

    // Check if users table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'users'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('Users table does not exist yet, creating...');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          email TEXT UNIQUE NOT NULL,
          name TEXT,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      `);
    }

    // Check if admin already exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      console.log(`Admin user ${email} already exists`);
      await pool.end();
      process.exit(0);
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create admin user
    const userId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, role, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [userId, email.toLowerCase(), 'Admin', passwordHash, 'admin']
    );

    console.log(`Created admin user: ${email}`);
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error creating admin user:', error.message);
    // Don't fail the container startup if admin creation fails
    process.exit(0);
  }
}

main();
