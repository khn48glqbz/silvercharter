import { graphqlPost } from "../client/graphql.js";

const PUBLICATIONS_QUERY = `
  {
    publications(first: 20) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

const PUBLISH_MUTATION = `
  mutation publishProduct($id: ID!, $publicationIds: [ID!]!) {
    publishablePublish(id: $id, input: { publicationIds: $publicationIds }) {
      userErrors { field message }
    }
  }
`;

let cachedPublications = null;

async function loadPublications() {
  if (cachedPublications) return cachedPublications;
  const res = await graphqlPost({ query: PUBLICATIONS_QUERY });
  const edges = res?.data?.publications?.edges || [];
  const map = new Map();
  edges.forEach((edge) => {
    const name = edge?.node?.name;
    const id = edge?.node?.id;
    if (name && id) {
      map.set(name.toLowerCase(), id);
    }
  });
  cachedPublications = map;
  return cachedPublications;
}

async function resolvePublicationIds(channels) {
  const map = await loadPublications();
  const targetNames = channels?.length ? channels : ["online store", "point of sale"];
  return targetNames
    .map((name) => map.get(name.toLowerCase()))
    .filter(Boolean);
}

export async function publishProduct(productId, channels = []) {
  if (!productId) return;
  const publicationIds = await resolvePublicationIds(channels);
  if (!publicationIds.length) return;
  const res = await graphqlPost({
    query: PUBLISH_MUTATION,
    variables: { id: productId, publicationIds },
  });
  const errors = res?.data?.publishablePublish?.userErrors;
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
}
