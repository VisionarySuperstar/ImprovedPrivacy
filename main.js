const { JsonRpcProvider, Contract, Wallet } = require("ethers");
const fs = require('fs').promises;
const readline = require('readline');
const createCsvStringifier = require('csv-writer').createObjectCsvStringifier;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

function promptUser(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadABI() {
  try {
    const data = await fs.readFile('./abi.json', 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading ABI:", error.message);
    return null;
  }
}

async function setupContract(rpcUrl) {
  const contractABI = await loadABI();
  if (!contractABI) {
    console.error("Failed to load ABI. Make sure abi.json is in the correct location.");
    return null;
  }

  const contractAddress = '0x8452DA49f0ae4dA4392b5714C2F0096997c93fE7';
  
  let provider;
  try {
    provider = new JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    console.log("Successfully connected to the network:", network.name);
  } catch (error) {
    console.error("Error connecting to the network:", error.message);
    return null;
  }

  try {
    const signer = new Wallet('fdc411de5b6650b3fddba095473939ce79eb0c01fe67d981f37ab3f01cca83cc', provider);
    const contract = new Contract(contractAddress, contractABI, signer);
    console.log("Contract instance created successfully.");
    console.log("Contract address:", contract.address);
    return contract;
  } catch (error) {
    console.error("Error creating contract instance:", error.message);
    return null;
  }
}

function convertBigIntToString(obj) {
  if (typeof obj === 'bigint') {
    return obj.toString();
  } else if (Array.isArray(obj)) {
    return obj.map(convertBigIntToString);
  } else if (typeof obj === 'object' && obj !== null) {
    const newObj = {};
    for (const key in obj) {
      newObj[key] = convertBigIntToString(obj[key]);
    }
    return newObj;
  }
  return obj;
}

function transformBribeCards(data) {
  return data.map(card => convertBigIntToString({
    plugin: card[0],
    bribe: card[1],
    isAlive: card[2],
    protocol: card[3],
    symbol: card[4],
    rewardTokens: card[5],
    rewardTokenDecimals: card[6],
    rewardsPerToken: card[7],
    accountRewardsEarned: card[8],
    voteWeight: card[9],
    votePercent: card[10],
    accountVote: card[11]
  }));
}

async function getBribeCards(contract, start, stop, account, retries = 0) {
  if (!contract || typeof contract.getBribeCards !== 'function') {
    console.error("Contract or getBribeCards function is not available.");
    return null;
  }
  try {
    console.log(`Fetching bribe cards for account ${account} from ${start} to ${stop}...`);
    const result = await contract.getBribeCards(start, stop, account);
    console.log("Raw result:", result);
    const transformedResult = transformBribeCards(result);
    return transformedResult;
  } catch (error) {
    console.error(`Error fetching bribe cards (attempt ${retries + 1}):`, error.message);
    if (error.data) {
      console.error("Error data:", error.data);
    }
    if (retries < MAX_RETRIES) {
      console.log(`Retrying in ${RETRY_DELAY / 1000} seconds...`);
      await sleep(RETRY_DELAY);
      return getBribeCards(contract, start, stop, account, retries + 1);
    } else {
      console.error("Max retries reached. Unable to fetch bribe cards.");
      return null;
    }
  }
}

async function batchProcessBribeCards(contract, start, stop, account, batchSize = 10) {
  const results = [];
  for (let i = start; i < stop; i += batchSize) {
    const batchStop = Math.min(i + batchSize, stop);
    const batchResults = await getBribeCards(contract, i, batchStop, account);
    if (batchResults) {
      results.push(...batchResults);
    } else {
      console.error(`Failed to fetch batch from ${i} to ${batchStop}`);
    }
  }
  return results;
}

async function saveToJsonFile(data, filename) {
  try {
    const jsonData = JSON.stringify(convertBigIntToString(data), null, 2);
    await fs.writeFile(filename, jsonData);
    console.log(`Data saved to ${filename}`);
  } catch (error) {
    console.error("Error saving data to JSON file:", error.message);
  }
}

function getMaxRewardTokens(jsonData) {
  return Math.max(...jsonData.map(item => item.rewardTokens.length));
}

function jsonToCsv(jsonData) {
  try {
    const maxRewardTokens = getMaxRewardTokens(jsonData);

    const headerItems = [
      {id: 'plugin', title: 'PLUGIN'},
      {id: 'bribe', title: 'BRIBE'},
      {id: 'isAlive', title: 'IS_ALIVE'},
      {id: 'protocol', title: 'PROTOCOL'},
      {id: 'symbol', title: 'SYMBOL'},
    ];

    for (let i = 0; i < maxRewardTokens; i++) {
      headerItems.push({id: `rewardToken${i}`, title: `REWARD_TOKEN_${i}`});
      headerItems.push({id: `rewardTokenDecimal${i}`, title: `REWARD_TOKEN_DECIMAL_${i}`});
      headerItems.push({id: `rewardPerToken${i}`, title: `REWARD_PER_TOKEN_${i}`});
    }

    headerItems.push(
      {id: 'accountRewardsEarned', title: 'ACCOUNT_REWARDS_EARNED'},
      {id: 'voteWeight', title: 'VOTE_WEIGHT'},
      {id: 'votePercent', title: 'VOTE_PERCENT'},
      {id: 'accountVote', title: 'ACCOUNT_VOTE'}
    );

    const csvStringifier = createCsvStringifier({
      header: headerItems
    });

    const records = jsonData.map((item, index) => {
      try {
        const record = {
          plugin: item.plugin,
          bribe: item.bribe,
          isAlive: item.isAlive,
          protocol: item.protocol,
          symbol: item.symbol,
          voteWeight: item.voteWeight,
          votePercent: item.votePercent,
          accountVote: item.accountVote
        };

        for (let i = 0; i < maxRewardTokens; i++) {
          record[`rewardToken${i}`] = item.rewardTokens[i] || '';
          record[`rewardTokenDecimal${i}`] = item.rewardTokenDecimals[i] || '';
          record[`rewardPerToken${i}`] = item.rewardsPerToken[i] || '';
        }

        record.accountRewardsEarned = item.accountRewardsEarned.join(', ');

        return record;
      } catch (error) {
        console.error(`Error processing item at index ${index}:`, error);
        console.error('Problematic item:', JSON.stringify(item, null, 2));
        return null;
      }
    }).filter(record => record !== null);

    const csvHeader = csvStringifier.getHeaderString();
    const csvRows = csvStringifier.stringifyRecords(records);

    return csvHeader + csvRows;
  } catch (error) {
    console.error('Error in jsonToCsv function:', error);
    throw error;
  }
}

async function saveToCsvFile(data, filename) {
  try {
    const csvData = jsonToCsv(data);
    await fs.writeFile(filename, csvData);
    console.log(`Data saved to ${filename}`);
  } catch (error) {
    console.error("Error saving data to CSV file:", error.message);
    console.error("Error stack:", error.stack);
    console.error("First few data items:", JSON.stringify(convertBigIntToString(data.slice(0, 3)), null, 2));
  }
}

function displayResults(results) {
  if (!results) return;
  console.log("\nBribe Cards:");
  console.log(JSON.stringify(convertBigIntToString(results), null, 2));
}

async function main() {
  const rpcUrl = 'https://bartio.rpc.berachain.com/';
  console.log("Using Berachain Artio testnet RPC URL:", rpcUrl);

  const contract = await setupContract(rpcUrl);
  if (!contract) {
    console.log("Failed to set up the contract. Exiting...");
    return;
  }

  while (true) {
    console.log("\n--- Bribe Cards Fetcher ---");
    const startInput = await promptUser("Enter start index (or 'q' to quit): ");
    if (startInput.toLowerCase() === 'q') break;
    
    const start = parseInt(startInput);
    if (isNaN(start)) {
      console.log("Invalid start index. Please enter a number.");
      continue;
    }

    const stopInput = await promptUser("Enter stop index: ");
    const stop = parseInt(stopInput);
    if (isNaN(stop)) {
      console.log("Invalid stop index. Please enter a number.");
      continue;
    }

    const account = await promptUser("Enter account address (or press Enter for zero address): ");
    const finalAccount = account || "0x0000000000000000000000000000000000000000";

    const batchSize = await promptUser("Enter batch size (default 10): ");
    const finalBatchSize = parseInt(batchSize) || 10;

    console.log("Fetching bribe cards in batches...");
    const results = await batchProcessBribeCards(contract, start, stop, finalAccount, finalBatchSize);
    if (results && results.length > 0) {
      displayResults(results);
      await saveToJsonFile(results, 'bribe_cards.json');
      await saveToCsvFile(results, 'bribe_cards.csv');
    } else {
      console.log("No results found or an error occurred.");
    }
  }

  rl.close();
}

main().catch(console.error).finally(() => process.exit(0));
