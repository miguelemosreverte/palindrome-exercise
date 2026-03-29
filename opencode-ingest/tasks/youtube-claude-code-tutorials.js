import { YouTubeFetcher } from '../vendors/youtube/fetch.js';

export default class extends YouTubeFetcher {
  constructor(name, dir) {
    super(name, dir, { query: 'claude code tutorial', maxPages: 5 });
  }
}
