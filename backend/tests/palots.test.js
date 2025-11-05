process.env.USE_MEM = '1';
process.env.ADMIN_USER = process.env.ADMIN_USER || '1';
process.env.ADMIN_PASS = process.env.ADMIN_PASS || 'pwd';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { hashPassword } = require('../src/utils/password');

beforeAll(async () => {
  const ensureUsers = [
    { username: '2', password: 'pwd', role: 'campo' },
    { username: '3', password: 'pwd', role: 'campo' },
  ];
  for (const user of ensureUsers) {
    const hash = hashPassword(user.password);
    const existing = await db.public.many('SELECT id FROM users WHERE username = $1', [user.username]);
    if (!existing || existing.length === 0) {
      const esc = (value) => String(value).replace(/'/g, "''");
      await db.public.none(
        `INSERT INTO users(username, password_hash, role) VALUES('${esc(user.username)}', '${esc(hash)}', '${esc(user.role)}')`
      );
    }
  }
});

describe('Palots API', () => {
  it('allows creating and listing palots', async () => {
    const resCreate = await request(app)
      .post('/palots')
      .set('Authorization', 'Basic ' + Buffer.from('1:pwd').toString('base64'))
      .send({ codigo: 'PALOT-1' });
    expect(resCreate.statusCode).toBe(201);
    expect(resCreate.body).toHaveProperty('id_usuario', 1);

    const resList = await request(app).get('/palots');
    expect(resList.statusCode).toBe(200);
    expect(resList.body.length).toBeGreaterThan(0);
  });

  it('registers parcela-palot relation', async () => {
    // Create parcela directly in DB
    const parcela = await db.public.one(
      'INSERT INTO parcelas(nombre) VALUES($1) RETURNING *',
      ['Parcela 1']
    );
    // Create palot via API
    const palotRes = await request(app)
      .post('/palots')
      .set('Authorization', 'Basic ' + Buffer.from('2:pwd').toString('base64'))
      .send({ codigo: 'PALOT-2' });
    const palotId = palotRes.body.id;
    // Assign relation
    const relRes = await request(app)
      .post(`/parcelas/${parcela.id}/palots`)
      .set('Authorization', 'Basic ' + Buffer.from('3:pwd').toString('base64'))
      .send({ palot_id: palotId, kgs: 0 });
    expect(relRes.statusCode).toBe(201);
    expect(relRes.body).toHaveProperty('id_usuario', 3);
    expect(relRes.body).toHaveProperty('kgs');

    const listRes = await request(app).get(`/parcelas/${parcela.id}/palots`);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0]).toHaveProperty('codigo', 'PALOT-2');
  });
});
