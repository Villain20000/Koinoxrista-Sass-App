import axios from 'axios';

describe('api root', () => {
  it('serves a hello message on GET /api', async () => {
    const res = await axios.get('/api');
    expect(res.status).toBe(200);
    expect(res.data.message).toBeTruthy();
  });
});
