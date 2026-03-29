/**
 * AFIP — Conversational fetcher
 *
 * Navigates afip.gob.ar with the user's credentials (asked via chat).
 * Saves HTML at every step. Extracts tax data for the report.
 */
import { createBrowser } from '../../lib/browser.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export async function fetchAFIP(agent, dataDir) {
  const htmlDir = join(dataDir, 'html');
  mkdirSync(htmlDir, { recursive: true });

  let step = 0;
  const saveHtml = async (page, label) => {
    step++;
    const path = join(htmlDir, `${String(step).padStart(3, '0')}-${label}.html`);
    writeFileSync(path, await page.content());
    return path;
  };

  agent.say('Hola! Voy a ayudarte a acceder a AFIP y generar un reporte con tu información fiscal.');
  agent.say('Necesito tus credenciales para iniciar sesión. La conexión es local — tus datos no salen de tu máquina.');

  // Ask for CUIT
  const cuit = await agent.ask('¿Cuál es tu CUIT/CUIL? (formato: XX-XXXXXXXX-X)');
  agent.setStatus('navigating', 'Abriendo AFIP...');

  // Launch browser
  const { browser, page, close } = await createBrowser({ headless: false });

  try {
    // Navigate to AFIP login
    agent.say('Navegando a AFIP...');
    await page.goto('https://auth.afip.gob.ar/contribuyente_/loginCuit.xhtml', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await saveHtml(page, 'login-page');

    // Enter CUIT
    agent.setStatus('navigating', 'Ingresando CUIT...');
    const cuitClean = cuit.replace(/[-.\s]/g, '');
    await page.fill('#F1\\:username', cuitClean);
    await page.click('#F1\\:btnSiguiente');
    await page.waitForTimeout(3000);
    await saveHtml(page, 'after-cuit');

    // Ask for password
    const clave = await agent.ask('¿Cuál es tu Clave Fiscal?');
    agent.setStatus('navigating', 'Ingresando clave...');

    // Enter password
    await page.fill('#F1\\:password', clave);
    await page.click('#F1\\:btnIngresar');
    await page.waitForTimeout(5000);
    await saveHtml(page, 'after-login');

    // Check if login succeeded
    const currentUrl = page.url();
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500));

    if (currentUrl.includes('error') || pageText.includes('incorrecto') || pageText.includes('error')) {
      agent.say('⚠️ No pude iniciar sesión. AFIP dice: ' + pageText.substring(0, 200));
      const retry = await agent.ask('¿Querés intentar de nuevo? (si/no)');
      if (retry.toLowerCase().startsWith('s')) {
        await close();
        return fetchAFIP(agent, dataDir);
      }
      return;
    }

    agent.say('✅ Sesión iniciada correctamente!');
    agent.setStatus('navigating', 'Explorando servicios...');

    // Navigate to "Mis Servicios" or main portal
    await saveHtml(page, 'portal');

    // Try to find and navigate key sections
    const sections = [
      { name: 'Datos personales', selector: 'a:has-text("Datos"), a:has-text("datos personales")' },
      { name: 'Mis comprobantes', selector: 'a:has-text("Comprobantes"), a:has-text("comprobantes")' },
      { name: 'Monotributo', selector: 'a:has-text("Monotributo"), a:has-text("monotributo")' },
      { name: 'SIRADIG', selector: 'a:has-text("SIRADIG"), a:has-text("Ganancias")' },
    ];

    agent.say('Explorando las secciones disponibles...');

    // Get all available links/services on the portal
    const availableServices = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a[href]').forEach(a => {
        const text = a.textContent.trim();
        if (text && text.length > 3 && text.length < 80) links.push({ text, href: a.href });
      });
      return links.filter(l => !l.href.includes('logout') && !l.href.includes('#'));
    });

    if (availableServices.length > 0) {
      agent.addToReport('<h2>Servicios disponibles</h2><ul>' +
        availableServices.slice(0, 30).map(s => `<li>${s.text}</li>`).join('') +
        '</ul>');
    }

    // Ask what the user wants to explore
    agent.say(`Encontré ${availableServices.length} servicios. Algunos que veo:`);
    const preview = availableServices.slice(0, 10).map(s => `• ${s.text}`).join('\n');
    agent.say(preview);

    const interest = await agent.ask('¿Qué sección te interesa explorar? (o "todo" para un reporte completo)');

    if (interest.toLowerCase().includes('todo') || interest.toLowerCase().includes('all')) {
      // Try to visit main sections
      for (const section of sections) {
        try {
          agent.setStatus('navigating', section.name);
          agent.say(`Explorando: ${section.name}...`);
          const link = await page.$(section.selector);
          if (link) {
            await link.click();
            await page.waitForTimeout(4000);
            await saveHtml(page, section.name.replace(/\s/g, '-').toLowerCase());

            const content = await page.evaluate(() => document.body.innerText.substring(0, 2000));
            agent.addToReport(`<h2>${section.name}</h2><pre style="white-space:pre-wrap;font-size:0.8rem">${content.substring(0, 1000)}</pre>`);

            await page.goBack();
            await page.waitForTimeout(2000);
          } else {
            agent.say(`No encontré "${section.name}" directamente.`);
          }
        } catch (err) {
          agent.say(`Error en ${section.name}: ${err.message.substring(0, 60)}`);
        }
      }
    } else {
      // Navigate to the user's chosen section
      const match = availableServices.find(s =>
        s.text.toLowerCase().includes(interest.toLowerCase())
      );
      if (match) {
        agent.setStatus('navigating', match.text);
        await page.goto(match.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4000);
        await saveHtml(page, 'user-choice');

        const content = await page.evaluate(() => document.body.innerText.substring(0, 3000));
        agent.addToReport(`<h2>${match.text}</h2><pre style="white-space:pre-wrap;font-size:0.8rem">${content.substring(0, 2000)}</pre>`);
      } else {
        agent.say(`No encontré un servicio que coincida con "${interest}". Guardé la página principal.`);
      }
    }

    // Final screenshot
    const ssDir = join(dataDir, 'screenshots');
    mkdirSync(ssDir, { recursive: true });
    await page.screenshot({ path: join(ssDir, 'final.png'), fullPage: true });

    agent.setStatus('done', 'Reporte generado');
    agent.say('✅ Listo! El reporte está en el panel de la derecha. Todos los HTMLs fueron guardados para análisis offline.');

    // Keep browser open for user to explore
    const keepOpen = await agent.ask('¿Querés que mantenga el navegador abierto para explorar más? (si/no)');
    if (!keepOpen.toLowerCase().startsWith('s')) {
      await close();
    }

  } catch (err) {
    agent.say(`❌ Error: ${err.message}`);
    agent.setStatus('done', 'Error');
    await close();
  }
}
