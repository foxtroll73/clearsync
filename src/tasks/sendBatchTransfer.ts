import fs from 'node:fs';
import readline from 'node:readline';

import { task, types } from 'hardhat/config';

import type { BatchTransfer, ERC20 } from '../../typechain-types';

const ADDRESS_ZERO = "0x"+'0'.repeat(40);
const MAX_BATCH_SIZE = 500;
const DEFAULT_INTERVAL = 10; // minutes
const addressRegex = /^0x[\dA-Fa-f]{40}$/;

interface TaskArgs {
  addressesPath: string;
  tokenAddress: string;
  batcherAddress: string;
  amount: number;
  tokenNative?: boolean;
  minBatchSize?: number;
  maxBatchSize?: number;
  minInterval?: number;
  maxInterval?: number;
}

task('sendBatchTransfer', 'Send batch transfer')
  .addParam('addressesPath', 'The path to the file with addresses')
  .addParam('tokenAddress', 'The token address')
  .addParam('batcherAddress', 'The batcher address')
  .addParam('amount', 'The amount to send')
  .addFlag('tokenNative', 'Whether the token is native (ETH)')
  .addOptionalParam('minBatchSize', 'The minimum batch size', undefined, types.int)
  .addOptionalParam('maxBatchSize', 'The maximum batch size', undefined, types.int)
  .addOptionalParam(
    'minInterval',
    'The minimum interval between batches (minutes)',
    undefined,
    types.int,
  )
  .addOptionalParam(
    'maxInterval',
    'The maximum interval between batches (minutes)',
    undefined,
    types.int,
  )
  .setAction(async (taskArgs: TaskArgs, { ethers }) => {
    const { addressesPath, tokenAddress, tokenNative, batcherAddress, amount } = taskArgs;
    const minBatchSize = taskArgs.minBatchSize ?? MAX_BATCH_SIZE;
    const maxBatchSize = taskArgs.maxBatchSize ?? MAX_BATCH_SIZE;
    const minInterval = taskArgs.minInterval ?? DEFAULT_INTERVAL;
    const maxInterval = taskArgs.maxInterval ?? DEFAULT_INTERVAL;

    if (minBatchSize > maxBatchSize) {
      throw new Error(
        `minBatchSize must be less than or equal to maxBatchSize: ${minBatchSize} > ${maxBatchSize}`,
      );
    } else if (minInterval > maxInterval) {
      throw new Error(
        `minInterval must be less than or equal to maxInterval: ${minInterval} > ${maxInterval}`,
      );
    } else if (maxBatchSize > MAX_BATCH_SIZE) {
      throw new Error(`maxBatchSize must be less than or equal to ${MAX_BATCH_SIZE}`);
    }

    const [sender] = await ethers.getSigners();

    console.log('Sending airdrops from address:', sender.address);
    const balanceBN = await sender.getBalance();
    console.log('Native balance:', balanceBN.toString());

    const addresses = await parseAddressesFile(addressesPath);
    const quantity = addresses.length;
    console.log(`Processed file with ${quantity} addresses`);

    const Token = (await ethers.getContractAt('ERC20', tokenAddress, sender)) as ERC20;
    const decimals = await Token.decimals();
    const amountFormatted = formatWithDecimals(amount.toString(), decimals);
    console.log(`Sending ${amountFormatted} tokens to each address`);

    let tokenBalance = await Token.balanceOf(batcherAddress);
    if (tokenNative) {
      tokenBalance = await ethers.provider.getBalance(batcherAddress);
    }

    const expectedCost = formatWithDecimals((quantity * amount).toString(), decimals);
    if (tokenBalance.lt(expectedCost)) {
      throw new Error(
        `Batcher address does not have enough tokens to send: ${tokenBalance.toString()} < ${expectedCost}`,
      );
    }

    const BatchTransfer = (await ethers.getContractAt(
      'BatchTransfer',
      batcherAddress,
      sender,
    )) as BatchTransfer;

    if (await BatchTransfer.owner() !== sender.address) {
      throw new Error('Sender is not the owner of the batcher contract');
    }

    let i = 0;
    while (i < addresses.length) {
      let batchSize = Math.floor(Math.random() * (maxBatchSize - minBatchSize + 1) + minBatchSize);
      if (i + batchSize > addresses.length) {
        batchSize = addresses.length - i;
      }
      console.log(`Sending batch of ${batchSize} addresses...`);

      const batchAddresses = addresses.slice(i, i + batchSize);
      const tx = await BatchTransfer.batchTransfer(tokenNative ? ADDRESS_ZERO : tokenAddress, batchAddresses, amountFormatted);
      console.log(`${i + 1}. Transaction hash: ${tx.hash}`);

      const interval = Math.floor(Math.random() * (maxInterval - minInterval + 1) + minInterval);
      console.log(`Waiting for ${interval} minutes...`);
      await new Promise((resolve) => setTimeout(resolve, interval * 60 * 1000));

      i += batchSize;
    }
  });

async function parseAddressesFile(path: string): Promise<string[]> {
  return new Promise((resolve, __) => {
    const addresses: string[] = [];

    const reader = fs.createReadStream(path);
    const rl = readline.createInterface({
      input: reader,
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    rl.on('line', (address) => {
      if (!addressRegex.test(address)) {
        console.log(`Invalid address: ${address}`);
        return;
      }

      if (address === ADDRESS_ZERO) return;

      addresses.push(address);
    }).on('close', () => {
      resolve(addresses);
    });
  });
}

function formatWithDecimals(value: string, decimals: number): string {
  const pointIndex = value.indexOf('.');
  if (pointIndex === -1) {
    return value + '0'.repeat(decimals);
  } else {
    const length = value.length - pointIndex - 1;
    return value.replace('.', '') + '0'.repeat(decimals - length);
  }
}
