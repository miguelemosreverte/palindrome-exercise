import { LinkedInFetcher } from '../vendors/linkedin/fetch.js';

export default class extends LinkedInFetcher {
  constructor(name, dir) {
    super(name, dir, {
      queries: [
        'scala senior engineer',
        'scala developer senior',
        'scala lead engineer',
        'scala architect',
        'senior backend scala',
      ],
      maxPages: 100,
    });
  }
}
