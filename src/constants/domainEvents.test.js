// Item 125 guards: one event registry (client == server CHECK), record-only events never notified, and the domain
// operations moved onto events never push directly again (their latest migration definition has no send-push call).
import fs from 'fs';
import path from 'path';
import { DOMAIN_EVENTS, RECORD_ONLY_EVENTS } from './domainEvents';

const MIG_DIR = path.join(__dirname, '../../supabase/migrations');
const MIGRATION = fs.readFileSync(path.join(MIG_DIR, '20270247_domain_events_notification_layer.sql'), 'utf8');

// latest definition of each public function across all migrations, in filename (replay) order
function latestDefinitions() {
  const defs = {};
  for (const f of fs.readdirSync(MIG_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
    const re = /create\s+or\s+replace\s+function\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\$function\$\s*;/gi;
    let m;
    while ((m = re.exec(sql))) defs[m[1]] = m[0];
  }
  return defs;
}

describe('domain event registry (item 125)', () => {
  it('the client registry equals the domain_events.type CHECK', () => {
    const check = /type text not null check \(type in \(([\s\S]*?)\)\)/.exec(MIGRATION)[1];
    const server = [...check.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(server.slice().sort()).toEqual(DOMAIN_EVENTS.slice().sort());
  });

  it('keeps BUSINESS_REQUEST_VIEWED out (item 39) and has no duplicate names', () => {
    expect(DOMAIN_EVENTS).not.toContain('BUSINESS_REQUEST_VIEWED');
    expect(new Set(DOMAIN_EVENTS).size).toBe(DOMAIN_EVENTS.length);
  });

  it('record-only events have no handler in the dispatcher', () => {
    const dispatch = /function public\._dispatch_domain_event[\s\S]*?end case;/.exec(MIGRATION)[0];
    RECORD_ONLY_EVENTS.forEach((e) => {
      expect(DOMAIN_EVENTS).toContain(e);
      expect(dispatch).not.toContain(`'${e}'`);
    });
  });

  it('domain operations moved onto events never call send-push directly', () => {
    const defs = latestDefinitions();
    const moved = [
      'invite_friend_to_gathering', 'send_social_invite', 'respond_to_social_invite', '_business_request_fanout',
      '_route_request_to_partner_core', '_route_gathering_to_partner_core', '_match_request_to_availability_core',
      '_match_request_to_package_core', '_match_request_to_policy_core', '_ai_auto_respond_to_business_requests',
      'submit_business_offer', 'admin_review_business_content_screening', 'accept_business_offer',
      '_accept_business_offer_internal', 'complete_business_reservation', '_notify_other_plan_participants',
      '_on_gathering_created', '_on_invitation_sent', '_on_business_request_sent', '_on_business_offer_sent',
      '_on_business_offer_accepted', '_dispatch_domain_event', '_emit_event', '_notify_event_recipient',
    ];
    moved.forEach((name) => {
      expect(defs[name]).toBeDefined();
      expect(defs[name]).not.toMatch(/functions\/v1\/send-push/);
    });
    expect(defs._send_push).toMatch(/functions\/v1\/send-push/);
    // the old direct gathering-created trigger function is gone
    expect(MIGRATION).toMatch(/drop function if exists public\.notify_matching_things_to_do\(\)/);
  });

  it('every emission uses a registry name and an idempotency key built from the object', () => {
    const emits = [...MIGRATION.matchAll(/_emit_event\('([A-Z_]+)'/g)].map((m) => m[1]);
    expect(emits.length).toBeGreaterThan(10);
    emits.forEach((e) => expect(DOMAIN_EVENTS).toContain(e));
    DOMAIN_EVENTS.forEach((e) => expect(emits).toContain(e));
  });

  it('no screen or client service sends or decides notifications', () => {
    const src = path.join(__dirname, '..');
    const offenders = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) return walk(p);
      if (!/\.js$/.test(d.name) || /\.(test|journey)\.js$/.test(d.name) || d.name === 'domainEvents.js') return;
      const t = fs.readFileSync(p, 'utf8');
      if (/functions\.invoke\(\s*['"]send-push['"]/.test(t) || /_emit_event|domain_events/.test(t)) offenders.push(p);
    });
    walk(src);
    expect(offenders).toEqual([]);
  });
});
