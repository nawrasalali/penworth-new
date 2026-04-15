/**
 * Penworth Database Migration Script
 * Migrates data from old Penworth (penworth.ai) to new Penworth (new.penworth.ai)
 * 
 * Usage: npx tsx scripts/migrate-from-old.ts
 * 
 * Required env vars:
 *   OLD_SUPABASE_URL, OLD_SUPABASE_SERVICE_KEY
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (new)
 */

import { createClient } from '@supabase/supabase-js';

// Configuration
const OLD_SUPABASE_URL = process.env.OLD_SUPABASE_URL!;
const OLD_SUPABASE_KEY = process.env.OLD_SUPABASE_SERVICE_KEY!;
const NEW_SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const NEW_SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 100;

interface MigrationStats {
  users: { total: number; migrated: number; failed: number };
  projects: { total: number; migrated: number; failed: number };
  chapters: { total: number; migrated: number; failed: number };
  credits: { total: number; migrated: number; failed: number };
}

const stats: MigrationStats = {
  users: { total: 0, migrated: 0, failed: 0 },
  projects: { total: 0, migrated: 0, failed: 0 },
  chapters: { total: 0, migrated: 0, failed: 0 },
  credits: { total: 0, migrated: 0, failed: 0 },
};

async function main() {
  console.log('🚀 Penworth Database Migration');
  console.log('================================');
  console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '⚡ LIVE MIGRATION'}`);
  console.log(`Old DB: ${OLD_SUPABASE_URL}`);
  console.log(`New DB: ${NEW_SUPABASE_URL}`);
  console.log('');

  if (!OLD_SUPABASE_URL || !OLD_SUPABASE_KEY) {
    console.error('❌ Missing OLD_SUPABASE_URL or OLD_SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  if (!NEW_SUPABASE_URL || !NEW_SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const oldDb = createClient(OLD_SUPABASE_URL, OLD_SUPABASE_KEY);
  const newDb = createClient(NEW_SUPABASE_URL, NEW_SUPABASE_KEY);

  try {
    // Step 1: Migrate Users/Profiles
    console.log('📦 Step 1: Migrating Users...');
    await migrateUsers(oldDb, newDb);

    // Step 2: Migrate Projects (Books)
    console.log('\n📦 Step 2: Migrating Projects...');
    await migrateProjects(oldDb, newDb);

    // Step 3: Migrate Chapters
    console.log('\n📦 Step 3: Migrating Chapters...');
    await migrateChapters(oldDb, newDb);

    // Step 4: Migrate Credits
    console.log('\n📦 Step 4: Migrating Credits...');
    await migrateCredits(oldDb, newDb);

    // Step 5: Generate referral codes for existing users
    console.log('\n📦 Step 5: Generating Referral Codes...');
    await generateReferralCodes(newDb);

    // Print summary
    printSummary();

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

async function migrateUsers(oldDb: any, newDb: any) {
  const { data: oldUsers, error } = await oldDb
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('  ❌ Failed to fetch old users:', error.message);
    return;
  }

  stats.users.total = oldUsers?.length || 0;
  console.log(`  Found ${stats.users.total} users to migrate`);

  if (!oldUsers || oldUsers.length === 0) return;

  for (let i = 0; i < oldUsers.length; i += BATCH_SIZE) {
    const batch = oldUsers.slice(i, i + BATCH_SIZE);
    
    for (const user of batch) {
      try {
        // Map old schema to new schema
        const newUser = {
          id: user.id,
          email: user.email,
          full_name: user.full_name || user.name || null,
          avatar_url: user.avatar_url || null,
          plan: mapPlan(user.plan || user.subscription_tier),
          credits_balance: user.credits_balance || user.credits || 1000,
          created_at: user.created_at,
          updated_at: user.updated_at || new Date().toISOString(),
          // New fields with defaults
          onboarding_completed: true,
          preferences: user.preferences || {},
        };

        if (!DRY_RUN) {
          const { error: insertError } = await newDb
            .from('profiles')
            .upsert(newUser, { onConflict: 'id' });

          if (insertError) throw insertError;
        }

        stats.users.migrated++;
      } catch (err: any) {
        console.error(`  ⚠️ Failed to migrate user ${user.id}:`, err.message);
        stats.users.failed++;
      }
    }

    console.log(`  Progress: ${Math.min(i + BATCH_SIZE, oldUsers.length)}/${oldUsers.length}`);
  }
}

async function migrateProjects(oldDb: any, newDb: any) {
  // Try different table names that old Penworth might use
  let oldProjects = null;
  let tableName = 'projects';

  for (const table of ['projects', 'books', 'documents']) {
    const { data, error } = await oldDb.from(table).select('*').limit(1);
    if (!error && data) {
      tableName = table;
      break;
    }
  }

  const { data, error } = await oldDb
    .from(tableName)
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error(`  ❌ Failed to fetch old ${tableName}:`, error.message);
    return;
  }

  oldProjects = data;
  stats.projects.total = oldProjects?.length || 0;
  console.log(`  Found ${stats.projects.total} projects to migrate`);

  if (!oldProjects || oldProjects.length === 0) return;

  for (let i = 0; i < oldProjects.length; i += BATCH_SIZE) {
    const batch = oldProjects.slice(i, i + BATCH_SIZE);

    for (const project of batch) {
      try {
        const newProject = {
          id: project.id,
          user_id: project.user_id || project.owner_id,
          org_id: null, // Will be set up separately if org exists
          title: project.title || project.name || 'Untitled Book',
          description: project.description || null,
          genre: project.genre || project.category || null,
          target_audience: project.target_audience || null,
          status: mapStatus(project.status),
          word_count: project.word_count || 0,
          chapter_count: project.chapter_count || 0,
          cover_url: project.cover_url || project.cover_image || null,
          created_at: project.created_at,
          updated_at: project.updated_at || new Date().toISOString(),
          settings: project.settings || project.metadata || {},
        };

        if (!DRY_RUN) {
          const { error: insertError } = await newDb
            .from('projects')
            .upsert(newProject, { onConflict: 'id' });

          if (insertError) throw insertError;
        }

        stats.projects.migrated++;
      } catch (err: any) {
        console.error(`  ⚠️ Failed to migrate project ${project.id}:`, err.message);
        stats.projects.failed++;
      }
    }

    console.log(`  Progress: ${Math.min(i + BATCH_SIZE, oldProjects.length)}/${oldProjects.length}`);
  }
}

async function migrateChapters(oldDb: any, newDb: any) {
  const { data: oldChapters, error } = await oldDb
    .from('chapters')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('  ❌ Failed to fetch old chapters:', error.message);
    return;
  }

  stats.chapters.total = oldChapters?.length || 0;
  console.log(`  Found ${stats.chapters.total} chapters to migrate`);

  if (!oldChapters || oldChapters.length === 0) return;

  for (let i = 0; i < oldChapters.length; i += BATCH_SIZE) {
    const batch = oldChapters.slice(i, i + BATCH_SIZE);

    for (const chapter of batch) {
      try {
        const newChapter = {
          id: chapter.id,
          project_id: chapter.project_id || chapter.book_id,
          title: chapter.title || `Chapter ${chapter.order || chapter.position || 1}`,
          content: chapter.content || '',
          order: chapter.order || chapter.position || 0,
          word_count: chapter.word_count || (chapter.content?.split(/\s+/).length || 0),
          status: chapter.status || 'draft',
          created_at: chapter.created_at,
          updated_at: chapter.updated_at || new Date().toISOString(),
        };

        if (!DRY_RUN) {
          const { error: insertError } = await newDb
            .from('chapters')
            .upsert(newChapter, { onConflict: 'id' });

          if (insertError) throw insertError;
        }

        stats.chapters.migrated++;
      } catch (err: any) {
        console.error(`  ⚠️ Failed to migrate chapter ${chapter.id}:`, err.message);
        stats.chapters.failed++;
      }
    }

    console.log(`  Progress: ${Math.min(i + BATCH_SIZE, oldChapters.length)}/${oldChapters.length}`);
  }
}

async function migrateCredits(oldDb: any, newDb: any) {
  // Try to find credit history table
  let tableName = 'credits_ledger';
  
  for (const table of ['credits_ledger', 'credit_history', 'credit_transactions', 'usage']) {
    const { data, error } = await oldDb.from(table).select('*').limit(1);
    if (!error && data) {
      tableName = table;
      break;
    }
  }

  const { data: oldCredits, error } = await oldDb
    .from(tableName)
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.log(`  ⚠️ No credit history found (tried: ${tableName})`);
    return;
  }

  stats.credits.total = oldCredits?.length || 0;
  console.log(`  Found ${stats.credits.total} credit records to migrate`);

  if (!oldCredits || oldCredits.length === 0) return;

  for (let i = 0; i < oldCredits.length; i += BATCH_SIZE) {
    const batch = oldCredits.slice(i, i + BATCH_SIZE);

    for (const credit of batch) {
      try {
        const newCredit = {
          id: credit.id,
          user_id: credit.user_id,
          org_id: null,
          amount: credit.amount || credit.credits,
          reason: credit.reason || credit.description || credit.type || 'migration',
          reference_id: credit.reference_id || credit.ref_id || null,
          reference_type: credit.reference_type || credit.type || null,
          created_at: credit.created_at,
        };

        if (!DRY_RUN) {
          const { error: insertError } = await newDb
            .from('credits_ledger')
            .upsert(newCredit, { onConflict: 'id' });

          if (insertError) throw insertError;
        }

        stats.credits.migrated++;
      } catch (err: any) {
        stats.credits.failed++;
      }
    }

    console.log(`  Progress: ${Math.min(i + BATCH_SIZE, oldCredits.length)}/${oldCredits.length}`);
  }
}

async function generateReferralCodes(newDb: any) {
  if (DRY_RUN) {
    console.log('  Skipping referral code generation (dry run)');
    return;
  }

  const { data: users, error } = await newDb
    .from('profiles')
    .select('id')
    .is('referral_code', null);

  if (error || !users) {
    console.error('  ❌ Failed to fetch users for referral codes');
    return;
  }

  console.log(`  Generating codes for ${users.length} users...`);

  for (const user of users) {
    const code = generateCode();
    
    // Insert into referral_codes table
    await newDb.from('referral_codes').insert({
      user_id: user.id,
      code,
      created_at: new Date().toISOString(),
    });
  }

  console.log(`  ✅ Generated ${users.length} referral codes`);
}

// Helper functions
function mapPlan(oldPlan: string | null): string {
  if (!oldPlan) return 'free';
  const plan = oldPlan.toLowerCase();
  if (plan.includes('pro') || plan.includes('premium')) return 'pro';
  if (plan.includes('max') || plan.includes('enterprise') || plan.includes('business')) return 'max';
  return 'free';
}

function mapStatus(oldStatus: string | null): string {
  if (!oldStatus) return 'draft';
  const status = oldStatus.toLowerCase();
  if (status.includes('publish')) return 'published';
  if (status.includes('complet')) return 'completed';
  if (status.includes('progress') || status.includes('writing')) return 'in_progress';
  return 'draft';
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function printSummary() {
  console.log('\n================================');
  console.log('📊 Migration Summary');
  console.log('================================');
  console.log(`Users:    ${stats.users.migrated}/${stats.users.total} (${stats.users.failed} failed)`);
  console.log(`Projects: ${stats.projects.migrated}/${stats.projects.total} (${stats.projects.failed} failed)`);
  console.log(`Chapters: ${stats.chapters.migrated}/${stats.chapters.total} (${stats.chapters.failed} failed)`);
  console.log(`Credits:  ${stats.credits.migrated}/${stats.credits.total} (${stats.credits.failed} failed)`);
  console.log('');
  
  if (DRY_RUN) {
    console.log('🔍 This was a DRY RUN. No data was actually migrated.');
    console.log('   Run without DRY_RUN=true to perform the actual migration.');
  } else {
    console.log('✅ Migration complete!');
  }
}

main();
