const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

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
    const parcela = db.public.one(
      'INSERT INTO parcelas(nombre, id_usuario) VALUES($1, $2) RETURNING *',
      ['Parcela 1', 1]
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
      .send({ palot_id: palotId });
    expect(relRes.statusCode).toBe(201);
    expect(relRes.body).toHaveProperty('id_usuario', 3);

    const listRes = await request(app).get(`/parcelas/${parcela.id}/palots`);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0]).toHaveProperty('codigo', 'PALOT-2');
  });
});
