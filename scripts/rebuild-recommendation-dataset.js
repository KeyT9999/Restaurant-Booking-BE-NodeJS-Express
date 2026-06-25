'use strict';

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const { createDatasetBuilderService } = require('../src/services/recommendation/dataset-builder.service');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const hasFlag = (flag) => process.argv.includes(flag);

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('Missing MONGO_URI environment variable.');
  }

  const confirmWrite = hasFlag('--confirm-write');
  const writeRequested = hasFlag('--write') || confirmWrite;
  const explicitDryRun = hasFlag('--dry-run');
  const dryRun = explicitDryRun || !writeRequested;
  const invalidateCache = !hasFlag('--no-cache-invalidate');

  if (!dryRun && !confirmWrite) {
    throw new Error('Write mode requires --confirm-write to avoid accidental dataset mutation.');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const datasetBuilder = createDatasetBuilderService();
  const result = await datasetBuilder.rebuildFullDataset({
    dryRun,
    confirmWrite: !dryRun && confirmWrite,
    invalidateCache,
    initiatedBy: 'cli',
    referenceDate: new Date(),
  });

  console.log(JSON.stringify(result, null, 2));
};

main()
  .catch((error) => {
    console.error('[recommendations:rebuild] failed');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
