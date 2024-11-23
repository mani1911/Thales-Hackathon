const issuer = {};
var {
  log,
  logIssuer,
  logOK,
  sendToProver,
  logKO,
  createAndOpenWallet,
  closeAndDeleteWallet,
  createAndOpenPoolHandle,
  closeAndDeletePoolHandle,
  createAndStoreMyDid,
  postSchemaToLedger,
  getSchemaFromLedger,
  postCredDefToLedger,
  sleep
} = require("./wallet-ledger-misc");
const indy = require("indy-sdk");
const express = require("express");
const bodyParser = require("body-parser");
const app = express();
var readline = require("readline-sync");
const util = require("./util");

app.use(bodyParser.urlencoded({ extended: true }));

//Main code starts here
async function run() {
  log("Set protocol version 2");
  await indy.setProtocolVersion(2);

  log("Issuer Open connections to ledger");
  issuer.poolHandle = await createAndOpenPoolHandle("issuer");

  log("Issuer Creates Wallet");
  issuer.wallet = await createAndOpenWallet("issuer");

  log("Issuer Create DID");
  issuer.did = await createAndStoreMyDid(
    issuer.wallet,
    "000000000000000000000000Steward1"
  );
  logKO("\tIssuer's DID is: " + issuer.did);

  logIssuer("Issuer creates credential schema");
  {
    const [schemaId, schema] = await indy.issuerCreateSchema(
      issuer.did,
      "gvt",
      "1.0",
      `["name", "age", "sex", "height"]`
    );
    issuer.schemaId = schemaId;
    issuer.schema = schema;
  }

  logIssuer("Issuer posts schema to ledger");
  await postSchemaToLedger(
    issuer.poolHandle,
    issuer.wallet,
    issuer.did,
    issuer.schema
  );

  logIssuer("Issuer gets schema from ledger");
  issuer.schema = await getSchemaFromLedger(
    issuer.poolHandle,
    issuer.did,
    issuer.schemaId
  );

  logIssuer("Issuer creates credential definition for schema");
  {
    const [
      credDefId,
      credDef
    ] = await indy.issuerCreateAndStoreCredentialDef(
      issuer.wallet,
      issuer.did,
      issuer.schema,
      "tag1",
      "CL",
      { support_revocation: false }
    ); //This example doesn't cover revocation case
    issuer.credDefId = credDefId;
    issuer.credDef = credDef;
  }

  logIssuer("Issuer posts credential definition");
  await postCredDefToLedger(
    issuer.poolHandle,
    issuer.wallet,
    issuer.did,
    issuer.credDef
  );

  log(
    "Issuer shares public data (schema ID, credential definition ID, ...) (via HTTP or other communication protocol) ..."
  );

  //Sending SchemaId to Prover
  logKO("\tSchemaId: " + issuer.schemaId);
  await sendToProver("schemaId", issuer.schemaId);

  //Sending CredDefId to Prover
  logKO("\tCredential Defination ID: " + issuer.credDefId);
  await sendToProver("credDefId", issuer.credDefId);

  logIssuer("Issuer creates credential offer");
  issuer.credOffer = await indy.issuerCreateCredentialOffer(
    issuer.wallet,
    issuer.credDefId
  );

  log(
    "Transfer credential offer from 'Issuer' to 'Prover' (via HTTP or other) ..."
  );
  await sendToProver("credOffer", JSON.stringify(issuer.credOffer));

  logOK("\nWaiting for Credential Request from prover!");
  while (issuer.credReq == undefined) {
    await sleep(2000);
  }

  const tailsWriterConfig = {
    base_dir: util.getPathToIndyClientHome() + "/tails",
    uri_pattern: ""
  };
  const tailsWriter = await indy.openBlobStorageWriter(
    "default",
    tailsWriterConfig
  );
  logIssuer("Issuer creates credential");
  {
    const credValues = {
      sex: {
        raw: "male",
        encoded: "5944657099558967239210949258394887428692050081607692519917050"
      },
      name: { raw: "Alex", encoded: "1139481716457488690172217916278103335" },
      height: { raw: "175", encoded: "175" },
      age: { raw: "28", encoded: "28" }
    };
    const [cred, _i, _d] = await indy.issuerCreateCredential(
      issuer.wallet,
      issuer.credOffer,
      issuer.credReq,
      credValues,
      undefined,
      tailsWriter
    );
    issuer.cred = cred;
  }

  logIssuer(
    "Transfer credential from 'Issuer' to 'Prover' (via HTTP or other) ..."
  );
  await sendToProver("cred", JSON.stringify(issuer.cred));
  issuer.cred = undefined;

  readline.question(
    "\n\nCredential successfully issued from issuer to prover, Press enter to terminate this session, delete issuer wallet, pool handle and teriminate program:"
  );

  log("Issuer close and delete wallets");
  await closeAndDeleteWallet(issuer.wallet, "issuer");

  log("Issuer close and delete poolHandles");
  await closeAndDeletePoolHandle(issuer.poolHandle, "issuer");
}

app.post("/issuer", (req, res) => {
  let type = req.body.type;
  let message = req.body.message;
  switch (type) {
    case "credReq":
      issuer.credReq = JSON.parse(message);
      break;
    default:
      break;
  }
  res.status(200).send({ status: 200 });
});

app.listen(3000, () => {
  console.log("Issuer started on port 3000!");
  run();
});
