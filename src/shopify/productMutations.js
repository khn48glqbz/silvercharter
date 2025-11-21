import { graphqlPost } from "./graphql.js";
import { setProductMetafields } from "./metafields.js";
import { adjustInventoryQuantity } from "./inventory.js";

const PRODUCT_CREATE_MUTATION = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        handle
        vendor
        productType
        variants(first: 5) {
          edges {
            node {
              id
              price
              barcode
              inventoryItem { id }
            }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id title handle vendor productType }
      userErrors { field message }
    }
  }
`;

const PRODUCT_DELETE_MUTATION = `
  mutation productDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors { field message }
    }
  }
`;

const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = `
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      product {
        id
        variants(first: 10) {
          edges {
            node {
              id
              price
              barcode
              inventoryItem { id }
            }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

export async function createProductDraft(input) {
  const res = await graphqlPost({ query: PRODUCT_CREATE_MUTATION, variables: { input } });
  const errors = res?.data?.productCreate?.userErrors;
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  const product = res?.data?.productCreate?.product;
  if (!product || !product.id) {
    console.error("productCreate response missing product:", JSON.stringify(res, null, 2));
    throw new Error("Shopify productCreate returned no product payload.");
  }
  return product;
}


export async function updateProductCore(productId, fields = {}) {
  if (!productId) throw new Error("Missing product ID.");
  const res = await graphqlPost({
    query: PRODUCT_UPDATE_MUTATION,
    variables: { input: { id: productId, ...fields } },
  });
  const errors = res?.data?.productUpdate?.userErrors;
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  return res?.data?.productUpdate?.product;
}

export async function updateVariantFields(productId, variantId, fields = {}) {
  if (!productId) throw new Error("Missing product ID for variant update.");
  if (!variantId) throw new Error("Missing variant ID for variant update.");
  const res = await graphqlPost({
    query: PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
    variables: {
      productId,
      variants: [{ id: variantId, ...fields }],
    },
  });
  const errors = res?.data?.productVariantsBulkUpdate?.userErrors;
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  const edges = res?.data?.productVariantsBulkUpdate?.product?.variants?.edges || [];
  const updated = edges.find((edge) => edge.node?.id === variantId)?.node || edges[0]?.node || null;
  return updated;
}

export async function updateVariantPrice(productId, variantId, price) {
  return updateVariantFields(productId, variantId, { price });
}

export async function setProductCondition(productId, fields) {
  return setProductMetafields(productId, fields);
}

export async function setInventoryQuantity(inventoryItemGid, currentQuantity, newQuantity) {
  if (!inventoryItemGid) throw new Error("Missing inventory item ID.");
  if (currentQuantity == null) currentQuantity = 0;
  if (newQuantity == null) throw new Error("New quantity required.");
  const delta = Number(newQuantity) - Number(currentQuantity);
  if (delta === 0) return null;
  return adjustInventoryQuantity(inventoryItemGid, delta);
}

export async function deleteProduct(productId) {
  if (!productId) throw new Error("Missing product ID.");
  const res = await graphqlPost({ query: PRODUCT_DELETE_MUTATION, variables: { input: { id: productId } } });
  const errors = res?.data?.productDelete?.userErrors;
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  return res?.data?.productDelete?.deletedProductId;
}
