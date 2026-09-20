// Request routing must be category-aware (migration 20270130) and stay rule-based.
const fs = require('fs');
const path = require('path');
const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270130_category_aware_request_routing.sql'), 'utf8');

test('fan-out filters by the request category group and ranks the exact tag first', () => {
  expect(sql).toContain('v_req_group := public.request_category_group(v_req_category);');
  expect(sql).toContain('(v_req_group is null or public.business_in_category_group(p.id, v_req_group))');
  expect(sql).toContain('v_req_category = any(public.business_served_tags(e.id))');
});
test('no AI or network call in the routing migration', () => {
  expect(sql).not.toMatch(/anthropic|openai|net\.http_post\(\s*url := 'https:\/\/api\./i);
});
