process.env.USE_MEM = '1';
process.env.ADMIN_USER = process.env.ADMIN_USER || '1';
process.env.ADMIN_PASS = process.env.ADMIN_PASS || 'pwd';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { hashPassword } = require('../src/utils/password');

const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

beforeAll(async () => {
  const esc = (value) => String(value).replace(/'/g, "''");
  const ensureUsers = [
    { username: 'admin-test', password: 'pwd', role: 'admin' },
    { username: 'campo-test', password: 'pwd', role: 'campo' },
  ];
  for (const user of ensureUsers) {
    const hash = hashPassword(user.password);
    const existing = await db.public.many('SELECT id FROM users WHERE username = $1', [user.username]);
    if (!existing || existing.length === 0) {
      await db.public.none(
        `INSERT INTO users(username, password_hash, role) VALUES('${esc(user.username)}', '${esc(hash)}', '${esc(user.role)}')`
      );
    }
  }
  const parcela = await db.public.one(
    `INSERT INTO parcelas(nombre) VALUES('Parcela Actividades') RETURNING id`
  );
  await db.public.one(
    `INSERT INTO olivos(id_parcela) VALUES(${parcela.id}) RETURNING id`
  );
});

describe('Activity Types API', () => {
  it('allows admin to create, update and delete activity types', async () => {
    const createRes = await request(app)
      .post('/activity-types')
      .set('Authorization', basic('admin-test', 'pwd'))
      .send({ nombre: 'Poda', icono: 'icon-poda' });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.body).toHaveProperty('id');

    const typeId = createRes.body.id;
    const updateRes = await request(app)
      .put(`/activity-types/${typeId}`)
      .set('Authorization', basic('admin-test', 'pwd'))
      .send({ nombre: 'Poda Fina', icono: 'poda' });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.body).toHaveProperty('nombre', 'Poda Fina');

    const listRes = await request(app)
      .get('/activity-types')
      .set('Authorization', basic('admin-test', 'pwd'));
    expect(listRes.statusCode).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.find((row) => row.id === typeId)).toBeTruthy();

    const deleteRes = await request(app)
      .delete(`/activity-types/${typeId}`)
      .set('Authorization', basic('admin-test', 'pwd'));
    expect(deleteRes.statusCode).toBe(204);
  });
});

describe('Activities API', () => {
  let typeId;
  let olivoId;

  beforeAll(async () => {
    const type = await db.public.one(
      'INSERT INTO activity_types(nombre, icono) VALUES($1, $2) RETURNING id',
      ['Riego', 'icon-riego']
    );
    typeId = type.id;
    const olivo = await db.public.one('SELECT id FROM olivos LIMIT 1');
    olivoId = olivo.id;
  });

  it('allows logging activities tied to an olivo', async () => {
    const createRes = await request(app)
      .post('/activities')
      .set('Authorization', basic('campo-test', 'pwd'))
      .send({
        activity_type_id: typeId,
        olivo_id: olivoId,
        personas: 3,
        notas: 'Actividad de prueba',
      });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.body).toHaveProperty('activity_type_id', typeId);
    expect(createRes.body).toHaveProperty('olivo_id', olivoId);

    const listRes = await request(app)
      .get('/activities')
      .set('Authorization', basic('campo-test', 'pwd'));
    expect(listRes.statusCode).toBe(200);
    const found = listRes.body.find((row) => row.id === createRes.body.id);
    expect(found).toBeTruthy();
  });
});
