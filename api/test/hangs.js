'use strict';

const factory = rootRequire('factory');

describe('Hang share link endpoint', () => {
  describe('GET /share/hangs', () => {
    it('400s if shareCode is invalid', async () => {
      const resp = await chai.request(server)
        .get('/share/hangs/abcd1234/abcd12345')
        .send();

      currentResponse = resp;
      resp.should.have.status(400);
    });

    it('404s if hang does not exist', async () => {
      const { uA } = await factory.hang();

      const resp = await chai.request(server)
        .get(`/share/hangs/100000000/${uA.inviteCode}`)
        .send();

      currentResponse = resp;
      resp.should.have.status(404);

      await uA.destroy();
    });

    it('404s if user does not exist', async () => {
      const {uA, hang} = await factory.hang();

      const resp = await chai.request(server)
        .get(`/share/hangs/${hang.shareCode}/100000000`)
        .send();

      currentResponse = resp;
      resp.should.have.status(404);

      await uA.destroy();
    });

    it('200s if share and invite code are valid', async () => {
      const { uA, hang } = await factory.hang({ addMedia: true });

      const resp = await chai.request(server)
        .get(`/share/hangs/${hang.shareCode}/${uA.inviteCode}`)
        .send();

      currentResponse = resp;
      resp.should.have.status(200);

      resp.text.should.contain(hang.title);
      resp.text.should.contain(hang.media.largeUrl);

      await uA.destroy();
    });

    it('200s if requesting json', async () => {
      const { uA, hang } = await factory.hang();

      const resp = await chai.request(server)
        .get(`/share/hangs/${hang.shareCode}/${uA.inviteCode}`)
        .query({ json: true })
        .send();

      currentResponse = resp;
      resp.should.have.status(200);

      resp.body.hang.id.should.equal(hang.id);
      resp.body.sharer.id.should.equal(uA.id);

      await uA.destroy();
    });
  });
});
