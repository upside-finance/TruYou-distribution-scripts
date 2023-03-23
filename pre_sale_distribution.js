const fs = require("fs");
const { parse } = require("csv-parse");
const { default: algosdk } = require("algosdk");
const ObjectsToCsv = require("objects-to-csv");
const { load } = require("csv-load-sync");

require("dotenv").config();

const main = async () => {
  const token =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const server = `https://${process.env.ALGO_NETWORK}-api.algonode.cloud`;
  const client = new algosdk.Algodv2(token, server, "");
  let params = await client.getTransactionParams().do();
  const distributorAcc = algosdk.mnemonicToSecretKey(
    process.env.DISTRIBUTOR_MNEMONIC
  );
  const decimals = parseInt(process.env.ASA_DECIMALS);
  const asaID = Number(process.env.ASA_ID);
  const month = parseInt(process.env.MONTH);

  const calcTokenDistributionForMonth = (totalTokens, month) => {
    if (month == 1) {
      return totalTokens * 0.1;
    } else {
      let alreadyDistributed;
      if (month == 2) {
        alreadyDistributed = totalTokens * 0.1;
      } else {
        alreadyDistributed =
          totalTokens * 0.1 + totalTokens * 0.9 * 0.08 * (month - 2);
      }

      if (alreadyDistributed >= totalTokens) {
        return 0;
      } else {
        const toBeDistributed = totalTokens * 0.9 * 0.08;
        return Math.min(toBeDistributed, totalTokens - alreadyDistributed);
      }
    }
  };

  const processSentTx = async (receiver, amountSU) => {
    const amountAU = BigInt(amountSU * 10 ** decimals);

    const txn = algosdk.makeAssetTransferTxnWithSuggestedParams(
      distributorAcc.addr,
      receiver,
      undefined,
      undefined,
      amountAU,
      undefined,
      asaID,
      params
    );

    const signedTx = algosdk.signTransaction(txn, distributorAcc.sk);
    await client.sendRawTransaction(signedTx.blob).do();
    await algosdk.waitForConfirmation(client, signedTx.txID, 20);

    return { txID: signedTx.txID, amount: amountAU };
  };

  const genOutputCSV = async (distributionArr, fileName) => {
    const csv = new ObjectsToCsv(distributionArr);
    await csv.toDisk(`./output/pre_sale/${fileName}_month_${month}.csv`, {
      append: true,
    });
  };

  const successfulDistribution = [];
  const unsuccessfulDistribution = [];

  const csv = load(
    "distribution_schedule/Presale Distribution Schedule and Allotments.csv"
  );
  for (const index in csv) {
    const row = csv[index];

    const address = row["Presale Addresses @ 0.005 per Trust token"];
    const totalTokens = parseFloat(row["Total Token Allotment Purchased"]);

    if (!algosdk.isValidAddress(address)) {
      console.log("Found Malformed Algorand address");
      unsuccessfulDistribution.push({
        Address: address,
        Total_token_allotment: totalTokens,
        Amount_to_be_distributed: null,
        Error: "Malformed Algorand address",
      });
      continue;
    }

    if (isNaN(totalTokens)) {
      console.log("Found Malformed total token amount");
      unsuccessfulDistribution.push({
        Address: address,
        Total_token_allotment: totalTokens,
        Amount_to_be_distributed: null,
        Error: "Malformed total token amount",
      });
      continue;
    }

    const thisMonthDistribution = calcTokenDistributionForMonth(
      totalTokens,
      month
    );

    await processSentTx(address, thisMonthDistribution)
      .then((v) => {
        successfulDistribution.push({
          Address: address,
          Amount_distributed: v.amount,
          TxID: v.txID,
        });
      })
      .catch((v) =>
        unsuccessfulDistribution.push({
          Address: address,
          Total_token_allotment: totalTokens,
          Amount_to_be_distributed: thisMonthDistribution,
          Error: v,
        })
      );

    setTimeout(() => {}, 1000);
  }

  genOutputCSV(successfulDistribution, "successful_distribution");
  genOutputCSV(unsuccessfulDistribution, "unsuccessful_distribution");
};

main();
