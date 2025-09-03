const request = require('supertest');
const app = require('../src/app');

describe('GET /', () => {
  it('responde con mensaje', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('message');
  });
});
