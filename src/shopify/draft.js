import axios from "axios";
import { graphqlPost, buildShopifyBase, getShopifyToken } from "./graphql.js";
import { adjustInventory } from "./inventory.js";
import { setSourceUrlMetafield } from "./metafields.js";

export default async function createDraftAndPublishToPos({ title, price, quantity, sourceUrl }, config) {
  const base = buildShopifyBase();
  const token = getShopifyToken();
  if (!base || !token) throw new Error("Missing SHOPIFY_STORE_URL or SHOPIFY_ADMIN_TOKEN.");

  let productId = null;
  let inventoryItemId = null;
  let isNewProduct = false;

  // ----- 1) Try to find existing product by metafield -----
  try {
    const query = {
      query: `
        query {
          products(first: 1, query: "metafields.pricecharting.source_url:\\"${sourceUrl}\\"") {
            edges {
              node {
                id
                title
                variants(first: 1) {
                  edges {
                    node {
                      id
                      inventoryItem { id }
                    }
                  }
                }
              }
            }
          }
        }
      `
    };
    const res = await graphqlPost(query);
    const existingEdge = res?.data?.products?.edges?.[0];
    if (existingEdge) {
      productId = existingEdge.node.id;
      inventoryItemId = existingEdge.node.variants?.edges?.[0]?.node?.inventoryItem?.id.match(/\/InventoryItem\/(\d+)$/)?.[1] || null;
      console.log("Existing product found:", existingEdge.node.title, productId);
    }
  } catch (err) {
    console.warn("Failed to query existing product:", err.message || err);
  }

  // ----- 2) If not found, create new product -----
  if (!productId) {
    const payload = {
      product: {
        title,
        vendor: config?.shopify?.vendor || "The Pokemon Company",
        product_type: "Pokemon Card",
        status: "draft",
        variants: [
          {
            price: Number(price).toFixed(2),
            inventory_management: "shopify",
            inventory_quantity: 0, // start at 0, adjust later
            weight: 2,
            weight_unit: "g",
          }
        ],
        tags: [config?.shopify?.collection || "Singles"],
      }
    };

    try {
      const createRes = await axios.post(`${base}/admin/api/2024-07/products.json`, payload, {
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      });
      const product = createRes.data?.product;
      productId = product?.id;
      inventoryItemId = product?.variants?.[0]?.inventory_item_id;
      isNewProduct = true;
      console.log(`Created new draft product ${title} (id: ${productId})`);
    } catch (err) {
      console.error("Product creation failed:", err.response?.status, err.response?.data || err.message);
      throw err;
    }
  }

  // ----- 3) Adjust inventory (for new or existing product) -----
  if (inventoryItemId && quantity > 0) {
    try {
      await adjustInventory(inventoryItemId, quantity);
    } catch (err) {
      // adjustInventory already logs details
    }
  }

  // ----- 4) Attach / update metafield -----
  try {
    await setSourceUrlMetafield(productId, sourceUrl);
  } catch (err) {
    // setSourceUrlMetafield logs errors
  }

  // ----- 5) Return clean info -----
  return {
    productId,
    inventoryItemId,
    isNewProduct,
  };
}
