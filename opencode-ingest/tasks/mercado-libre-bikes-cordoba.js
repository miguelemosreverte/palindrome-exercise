import { MercadoLibreFetcher } from '../vendors/mercadolibre/fetch.js';

export default class extends MercadoLibreFetcher {
  constructor(name, dir) {
    super(name, dir, { query: 'bicicleta', location: 'Córdoba', maxPages: 20 });
  }
}
