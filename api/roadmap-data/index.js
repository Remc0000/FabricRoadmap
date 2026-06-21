const https = require("https");

const PRODUCTS = [
  { id: "a821f83f-dbd6-ee11-9079-000d3a310f67", name: "Data Factory", qs: "datafactory" },
  { id: "0522b590-dcd6-ee11-9079-000d3a310f67", name: "Data Science", qs: "datascience" },
  { id: "fa3a73cd-dcd6-ee11-9079-000d3a310f67", name: "Data Warehouse", qs: "datawarehouse" },
  { id: "338c69fe-dcd6-ee11-9079-000d3a310f67", name: "OneLake", qs: "onelake" },
  { id: "c6da6b3b-ded6-ee11-9079-000d3a310f67", name: "Fabric Developer Experiences", qs: "fabricdeveloperexperiences" },
  { id: "796a0af7-2dc7-ee11-9079-000d3a3419a8", name: "Administration, Governance and Security", qs: "administration,governanceandsecurity" },
  { id: "a731518f-36ca-ee11-9079-000d3a341a60", name: "Data Engineering", qs: "dataengineering" },
  { id: "642a8375-05fc-ee11-a1ff-000d3a341a60", name: "Power BI", qs: "powerbi" },
  { id: "58cb90aa-4203-ef11-a1fd-000d3a36eea4", name: "Real-Time Intelligence", qs: "real-timeintelligence" },
  { id: "0e17459c-141b-f011-998a-00224804b6c3", name: "Cosmos DB", qs: "cosmosdb" },
  { id: "94e84e43-aa69-f011-bec2-00224804b6c3", name: "Fabric Ecosystem", qs: "fabricecosystem" },
  { id: "347da228-ea54-ef11-a317-0022480a694f", name: "SQL database", qs: "sqldatabase" },
  { id: "cef5a30d-562f-f011-8c4d-6045bd096d8f", name: "IQ", qs: "iq" }
];

const fetchJson = (url) =>
  new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(`Failed to fetch ${url}: ${response.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
          }
        });
      })
      .on("error", reject);
  });

const loadRoadmapItems = async () => {
  const all = [];
  for (const product of PRODUCTS) {
    const json = await fetchJson(`https://roadmap.fabric.microsoft.com/fabric-json/?productId=${product.id}`);
    for (const record of json.results || []) {
      all.push({
        product: product.name,
        productId: product.id,
        productQs: product.qs,
        releaseItemId: record.ReleaseItemID,
        featureName: record.FeatureName,
        releaseDate: record.ReleaseDate,
        releaseType: record.ReleaseType,
        releaseTypeValue: record.ReleaseTypeValue,
        releaseStatus: record.ReleaseStatus,
        releaseStatusValue: record.ReleaseStatusValue,
        releaseSemester: record.ReleaseSemester,
        description: record.FeatureDescription,
        isPublishExternally: record.isPublishExternally,
        url: `https://roadmap.fabric.microsoft.com/?product=${product.qs}#plan-${record.ReleaseItemID}`
      });
    }
  }

  return all;
};

module.exports = async function (context) {
  try {
    const items = await loadRoadmapItems();
    context.res = {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: items
    };
  } catch (error) {
    context.log.error(error);
    context.res = {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: {
        error: error.message || String(error)
      }
    };
  }
};
