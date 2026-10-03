// The only body /api/pet accepts. Strict: an unknown key (e.g. "prompt") is a 400. The server builds every prompt.
const { z } = require('zod');
const MAX_JPEG = 1.5 * 1024 * 1024;
const MODES = ['plan', 'stuck', 'drift', 'confirm', 'reentry'];
const Body = z.object({
  mode: z.enum(MODES),
  goal: z.string().trim().min(1).max(300),
  quests: z.array(z.object({ title: z.string().min(1).max(120), done: z.boolean() }).strict()).max(6).optional(),
  quest: z.object({ title: z.string().min(1).max(120), finish: z.string().max(200) }).strict().optional(),
  screenshot: z.string().max(5 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/).optional(),
  windowTitle: z.string().max(120).optional(),
  tzOffset: z.number().int().min(-840).max(840).optional(),
}).strict().refine((b) => b.mode === 'plan' || (b.quest && b.screenshot), { message: 'look modes need quest + screenshot' });
// Returns { body } | { status, error, issues? }.
function parse(raw) {
  const r = Body.safeParse(raw);
  if (!r.success) return { status: 400, error: 'bad body', issues: r.error.issues.map((i) => i.path.join('.') || i.message) };
  const b = r.data;
  if (b.screenshot) {
    const buf = Buffer.from(b.screenshot, 'base64');
    if (buf.length > MAX_JPEG) return { status: 413, error: 'image too large' };
    if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return { status: 400, error: 'bad body', issues: ['screenshot: not a JPEG'] };
  }
  return { body: b };
}
module.exports = { parse, MAX_JPEG, MODES };
