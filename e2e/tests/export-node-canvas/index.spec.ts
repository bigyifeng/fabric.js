import { expect, test } from '@playwright/test';
import { Canvas } from 'canvas';
import * as fabric from 'fabric/node';
import { createWriteStream, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import path from 'path';

import '../../setup/setupCoverage';

test.describe('Exporting node canvas', () => {
  const generateCanvas = (type: 'pdf' | 'svg') => {
    const canvas = new fabric.StaticCanvas(null, {
      width: 1000,
      height: 1000,
      enableRetinaScaling: false,
    });
    const rect = new fabric.Rect({ width: 50, height: 50, fill: 'red' });
    const path = fabric.util.getSmoothPathFromPoints([
      new fabric.Point(50, 50),
      new fabric.Point(100, 100),
      new fabric.Point(50, 200),
      new fabric.Point(400, 150),
      new fabric.Point(500, 500),
    ]);
    const text = new fabric.Text(new Array(9).fill('fabric.js').join(' '), {
      fill: 'blue',
      fontSize: 24,
      path: new fabric.Path(path),
    });
    canvas.add(rect, text);
    const ctx = new Canvas(0, 0, type).getContext('2d');
    ctx.textDrawingMode = 'glyph';
    const size = {
      width: 460,
      height: 450,
    };
    const out = canvas.toCanvasElement(1, size, ctx);
    expect(out).toMatchObject(size);
    return out;
  };

  test('SVG', async ({ page }, testInfo) => {
    const svg = generateCanvas('svg');
    const buf = svg.toBuffer();
    ensureDirSync(testInfo.outputDir);
    const pathTo = path.resolve(testInfo.outputDir, 'output.svg');
    writeFileSync(pathTo, buf);
    testInfo.attach('output', {
      body: buf,
    });
    await page.goto(
      `data:image/svg+xml,${encodeURIComponent(buf.toString())
        .replace(/'/g, '%27')
        .replace(/"/g, '%22')}`,
      { waitUntil: 'load' }
    );
    expect(
      await page.screenshot({ clip: { x: 0, y: 0, width: 460, height: 450 } })
    ).toMatchSnapshot();
  });

  test('PDF', async ({ page }, testInfo) => {
    const pdf = generateCanvas('pdf');
    // attach
    ensureDirSync(testInfo.outputDir);
    const pathTo = path.resolve(testInfo.outputDir, 'output.pdf');
    const out = createWriteStream(pathTo);
    await new Promise((resolve) => {
      out.on('finish', resolve);
      pdf.createPDFStream().pipe(out);
    });
    testInfo.attach('output', {
      path: pathTo,
      contentType: 'application/pdf',
    });
    // test
    await page.goto(
      `data:application/pdf;base64,${Buffer.from(pdf.toBuffer()).toString(
        'base64'
      )}`,
      { waitUntil: 'load' }
    );
    await page.waitForTimeout(5000);
    expect(
      await page.screenshot({
        clip: { x: 80, y: 25, width: 500, height: 500 },
      })
    ).toMatchSnapshot();
  });
});
