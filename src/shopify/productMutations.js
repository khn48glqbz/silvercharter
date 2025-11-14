import { graphqlPost } from "./graphql.js";
import { setProductMetafields } from "./metafields.js";
import { adjustInventory } from "./inventory.js";

const VARIANT_UPDATE_MUTATION = `
  mutation variantUpdate($input: ProductVariantInput!) {
    productVariantUpdate(input: $input) {
      productVariant { id price }
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

export async function updateVariantPrice(variantId, price) {
  if (!variantId) throw new Error("Missing variant ID for price update.");
  const variables = { input: { id: variantId, price } };
  const res = await graphqlPost({ query: VARIANT_UPDATE_MUTATION, variables });
  const errors = res?.data?.productVariantUpdate?.userErrors;
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  return res?.data?.productVariantUpdate?.productVariant;
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
  const numericId = inventoryItemGid.replace(/\D/g, "");
  if (!numericId) throw new Error("Invalid inventory item ID.");
  return adjustInventory(numericId, delta);
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
