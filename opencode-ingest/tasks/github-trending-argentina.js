import { GitHubFetcher } from '../vendors/github/fetch.js';

export default class extends GitHubFetcher {
  constructor(name, dir) {
    super(name, dir, { query: 'location:Argentina stars:>10', maxPages: 10 });
  }
}
