import { findProductBySourceUrlAndCondition, setProductMetafields } from "./metafields.js";
import { generateEAN13 } from "../utils/barcode.js";
import {
  adjustInventoryQuantity,
  activateInventoryLevel,
  ensureVariantInventoryManagement,
} from "./inventory.js";
import { createProductDraft, updateProductCore, updateVariantFields } from "./productMutations.js";

export default async function createDraftAndPublishToPos(card, config) {
  let {
    title,
    price,
    quantity,
    sourceUrl,
    condition,
    barcode,
    vendor,
    game,
    expansion,
    language,
    collection,
    expansionIconId,
    value,
    signed = false,
  } = card;

  if (signed && !title.includes("(Signature)")) {
    title = `${title} (Signature)`;
  }

  if (!barcode) {
    barcode = generateEAN13();
  }
  const handle = String(barcode).trim();
  const resolvedVendor = vendor || game || "Unknown Vendor";
  const productTypeValue = "Trading Card";

  const existing = await findProductBySourceUrlAndCondition(sourceUrl, condition, { signed });
  if (existing) {
    await updateProductCore(existing.id, {
      vendor: resolvedVendor,
      productType: productTypeValue,
      handle,
      title,
    });

    let updatedVariant = existing.variantId ? { id: existing.variantId } : null;
    if (existing.variantId) {
      updatedVariant = await updateVariantFields(existing.id, existing.variantId, {
        price,
        barcode,
      });
      await ensureVariantInventoryManagement(existing.variantId);
    }

    const existingInventoryItemId = updatedVariant?.inventoryItem?.id || updatedVariant?.inventoryItemId || existing.inventoryItemId;
    if (existingInventoryItemId && Number(quantity) !== 0) {
      try {
        await adjustInventoryQuantity(existingInventoryItemId, quantity);
      } catch (err) {
        console.warn("Inventory adjustment failed:", err.message || err);
      }
    } else if (!existingInventoryItemId) {
      console.warn(`No inventory item found for ${existing.title}. Inventory not adjusted.`);
    }

    await setProductMetafields(existing.id, {
      sourceUrl,
      condition,
      game,
      expansion,
      language,
      type: collection,
      expansionIconId,
      value,
      signature: signed,
    });

    return { ...existing, barcode };
  }

  const productPayload = {
    title,
    vendor: resolvedVendor,
    productType: productTypeValue,
    handle,
    status: "DRAFT",
  };

  const created = await createProductDraft(productPayload);
  const variantNode = created?.variants?.edges?.[0]?.node || null;
  let updatedVariant = variantNode;
  if (variantNode) {
    updatedVariant = await updateVariantFields(created.id, variantNode.id, {
      price,
      barcode,
    });
    await ensureVariantInventoryManagement(variantNode.id);
    const inventoryItemId = updatedVariant?.inventoryItem?.id || variantNode?.inventoryItem?.id;
    if (inventoryItemId && Number(quantity) > 0) {
      try {
        await activateInventoryLevel(inventoryItemId, quantity);
      } catch (err) {
        console.warn("Failed to activate inventory level:", err.message || err);
        try {
          await adjustInventoryQuantity(inventoryItemId, quantity);
        } catch (adjustErr) {
          console.warn("Inventory adjustment fallback failed:", adjustErr.message || adjustErr);
        }
      }
    } else if (!inventoryItemId) {
      console.warn("No inventory item returned for new variant; skipping inventory updates.");
    }
  }

  await setProductMetafields(created.id, {
    sourceUrl,
    condition,
    game,
    expansion,
    language,
    type: collection,
    expansionIconId,
    value,
    signature: signed,
  });

  return {
    id: created.id,
    title: created.title,
    barcode,
    variantId: updatedVariant?.id || variantNode?.id || null,
    inventoryItemId: updatedVariant?.inventoryItem?.id || variantNode?.inventoryItem?.id || null,
    price,
  };
}
