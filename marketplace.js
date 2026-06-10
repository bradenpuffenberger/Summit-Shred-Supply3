import { Amplify, fetchAuthSession } from 'https://esm.sh/@aws-amplify/core@6.16.2';
import {
  cognitoCredentialsProvider,
  cognitoUserPoolsTokenProvider,
  fetchUserAttributes,
  getCurrentUser,
  updateUserAttributes,
} from 'https://esm.sh/@aws-amplify/auth@6.19.1/cognito?deps=@aws-amplify/core@6.16.2';
import { generateClient } from 'https://esm.sh/@aws-amplify/api@6.3.25?deps=@aws-amplify/core@6.16.2';
import {
  getUrl,
  uploadData,
} from 'https://esm.sh/@aws-amplify/storage@6.14.0?deps=@aws-amplify/core@6.16.2';

const CONFIG_PATHS = ['/amplify_outputs.json', '/amplifyconfiguration.json'];
const MARKETPLACE_FEE_RATE = 0.05;

let client = null;
let readyPromise = null;

function normalizeQuantity(value) {
  const quantity = Number.parseInt(value, 10);
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(99, Math.max(1, quantity));
}

function availableQuantity(listing) {
  if (listing?.quantityAvailable == null) return 1;
  const quantity = Number.parseInt(listing.quantityAvailable, 10);
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(99, Math.max(0, quantity));
}

function marketplaceFee(price) {
  const cents = Number(price);
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return Math.round(cents * MARKETPLACE_FEE_RATE);
}

function isAvailableListing(listing) {
  return listing?.status === 'ACTIVE' && availableQuantity(listing) > 0;
}

function normalizeItemSelection(value) {
  const clean = String(value || '').trim().slice(0, 80);
  return clean || 'Item 1';
}

async function loadConfig() {
  for (const path of CONFIG_PATHS) {
    try {
      const response = await fetch(path, { cache: 'no-store' });
      if (response.ok) return normalizeConfig(await response.json());
    } catch {
      // Try the next known Amplify config filename.
    }
  }

  throw new Error('Missing Amplify config.');
}

function normalizeConfig(config) {
  if (config.Auth?.Cognito?.userPoolId && config.API?.GraphQL?.endpoint) {
    return normalizeStorageConfig(config);
  }

  const auth = config.auth || {};
  const data = config.data || {};

  return normalizeStorageConfig({
    ...config,
    Auth: {
      Cognito: {
        userPoolId: auth.user_pool_id,
        userPoolClientId: auth.user_pool_client_id,
        identityPoolId: auth.identity_pool_id,
        allowGuestAccess: auth.unauthenticated_identities_enabled,
        loginWith: {
          email: auth.username_attributes?.includes('email') ?? true,
          phone: auth.username_attributes?.includes('phone_number') ?? false,
          username: auth.username_attributes?.includes('username') ?? false,
        },
      },
    },
    API: {
      GraphQL: {
        endpoint: data.url,
        region: data.aws_region,
        defaultAuthMode: 'userPool',
        modelIntrospection: data.model_introspection,
      },
    },
  });
}

function normalizeStorageConfig(config) {
  if (config.Storage?.S3?.bucket && config.Storage?.S3?.region) return config;

  const storage = config.storage || {};
  const primaryBucket = storage.buckets?.[0] || {};
  const bucket = storage.bucket_name || primaryBucket.bucket_name;
  const region = storage.aws_region || primaryBucket.aws_region;

  if (!bucket || !region) return config;

  return {
    ...config,
    Storage: {
      S3: {
        bucket,
        region,
      },
    },
  };
}

async function ensureReady() {
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    const config = await loadConfig();
    cognitoUserPoolsTokenProvider.setAuthConfig(config.Auth);
    Amplify.configure(config, {
      Auth: {
        tokenProvider: cognitoUserPoolsTokenProvider,
        credentialsProvider: cognitoCredentialsProvider,
      },
    });
    client = generateClient({ authMode: 'userPool' });
    return client;
  })();

  return readyPromise;
}

async function getProfile() {
  await ensureReady();
  const [user, attributes] = await Promise.all([
    getCurrentUser(),
    fetchUserAttributes().catch(() => ({})),
  ]);
  const email = attributes.email || user.signInDetails?.loginId || '';
  const savedDisplayName = attributes.name || attributes.preferred_username || '';
  const UserProfile = client?.models?.UserProfile;
  const { data: profileRows } = UserProfile
    ? await UserProfile.list({ filter: { userSub: { eq: attributes.sub || user.userId } } }).catch(() => ({ data: [] }))
    : { data: [] };
  const appProfile = profileRows?.[0] || null;
  const displayName = appProfile?.displayName || savedDisplayName || user.username || 'Summit Rider';
  return {
    sub: attributes.sub || user.userId,
    username: user.username,
    email,
    displayName,
    hasDisplayName: Boolean(displayName && !displayName.includes('@') && displayName !== 'Summit Rider'),
    avatarKey: appProfile?.avatarKey || '',
    avatarUrl: appProfile?.avatarKey ? await resolveImageUrl(appProfile.avatarKey).catch(() => '') : '',
  };
}

function storageRef(path) {
  return path?.startsWith('storage://') ? path : `storage://${path}`;
}

function storagePath(ref) {
  return uploadStorageKey(ref) || String(ref || '').replace(/^storage:\/\//, '');
}

function uploadStorageKey(ref) {
  const value = String(ref || '').trim();
  const cleanValue = value.replace(/^storage:\/\//, '');
  const directMatch = cleanValue.match(/^(listing-images|profile-images)\/.+/);
  if (directMatch) return cleanValue;

  try {
    const url = new URL(value);
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const nestedMatch = key.match(/(listing-images|profile-images)\/.+/);
    if (nestedMatch) return key.slice(nestedMatch.index);
  } catch {
    // Non-URL refs are handled by the direct storage-key match above.
  }

  return '';
}

async function resolveImageUrl(ref) {
  if (!ref) return '';
  const key = storagePath(ref);
  if (!key || (!String(ref).startsWith('storage://') && !uploadStorageKey(ref))) return ref;
  const { url } = await getUrl({ path: key, options: { expiresIn: 3600, validateObjectExistence: true } });
  return url.toString();
}

async function resolveImageList(refs) {
  const urls = await Promise.all((refs || []).filter(Boolean).map(ref =>
    resolveImageUrl(ref).catch(error => {
      console.warn('Could not resolve listing image URL.', { ref, error });
      return '';
    })
  ));
  return urls.filter(Boolean);
}

async function hydrateListing(listing) {
  if (!listing) return listing;
  const imageUrls = await resolveImageList(listing.imageUrls);
  const sellerAvatarUrl = await resolveImageUrl(listing.sellerAvatarKey).catch(() => '');
  return {
    ...listing,
    imageRefs: listing.imageUrls || [],
    imageUrls,
    sellerAvatarUrl,
  };
}

async function uploadImage(blob, folder = 'listing-images', fileName = 'image.jpg') {
  await ensureReady();
  const profile = await getProfile();
  const safeName = String(fileName || 'image.jpg').replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `${folder}/${profile.sub}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  await uploadData({
    path,
    data: blob,
    options: {
      contentType: blob.type || 'image/jpeg',
    },
  }).result;
  return storageRef(path);
}

async function getOrCreateUserProfile(profile, next = {}) {
  const UserProfile = requireModel('UserProfile');
  const { data } = await UserProfile.list({ filter: { userSub: { eq: profile.sub } } });
  const existing = data?.[0];
  if (existing) {
    const { data: updated } = await UserProfile.update({ id: existing.id, ...next });
    return updated;
  }
  const { data: created } = await UserProfile.create({
    userSub: profile.sub,
    displayName: profile.displayName,
    avatarKey: '',
    ...next,
  });
  return created;
}

function requireDisplayName(profile) {
  if (!profile?.hasDisplayName) {
    throw new Error('Set a display name before using marketplace features.');
  }
}

async function updateDisplayName(displayName) {
  await ensureReady();
  const cleanName = String(displayName || '').trim().slice(0, 40);
  if (cleanName.length < 2) throw new Error('Display name must be at least 2 characters.');
  if (cleanName.includes('@')) throw new Error('Display name cannot be an email address.');

  await updateUserAttributes({
    userAttributes: {
      name: cleanName,
      preferred_username: cleanName,
    },
  });

  const profile = await getProfile();
  const appProfile = await getOrCreateUserProfile(profile, { displayName: cleanName });
  const Listing = requireModel('Listing');
  const { data: ownListings } = await Listing.list({
    filter: { sellerSub: { eq: profile.sub } },
  }).catch(() => ({ data: [] }));

  await Promise.all((ownListings || []).map(listing =>
    Listing.update({ id: listing.id, sellerName: cleanName, sellerAvatarKey: appProfile.avatarKey }).catch(() => null)
  ));

  return { ...profile, displayName: cleanName, avatarKey: appProfile.avatarKey, avatarUrl: await resolveImageUrl(appProfile.avatarKey).catch(() => '') };
}

async function updateProfileAvatar(blob, fileName = 'avatar.jpg') {
  await ensureReady();
  const profile = await getProfile();
  requireDisplayName(profile);
  const avatarKey = await uploadImage(blob, 'profile-images', fileName);
  const appProfile = await getOrCreateUserProfile(profile, {
    displayName: profile.displayName,
    avatarKey,
  });
  const Listing = requireModel('Listing');
  const { data: ownListings } = await Listing.list({
    filter: { sellerSub: { eq: profile.sub } },
  }).catch(() => ({ data: [] }));
  await Promise.all((ownListings || []).map(listing =>
    Listing.update({ id: listing.id, sellerAvatarKey: avatarKey }).catch(() => null)
  ));
  return { ...profile, avatarKey, avatarUrl: await resolveImageUrl(avatarKey).catch(() => '') };
}

function requireModel(name) {
  if (!client?.models?.[name]) {
    throw new Error(`${name} is not available yet. Deploy the updated Amplify Data schema first.`);
  }
  return client.models[name];
}

function groupsFromSession(session) {
  const idGroups = session?.tokens?.idToken?.payload?.['cognito:groups'];
  const accessGroups = session?.tokens?.accessToken?.payload?.['cognito:groups'];
  return [...(Array.isArray(idGroups) ? idGroups : []), ...(Array.isArray(accessGroups) ? accessGroups : [])];
}

async function getAdminStatus() {
  await ensureReady();
  const session = await fetchAuthSession();
  const groups = [...new Set(groupsFromSession(session).map(String))];
  return {
    isAdmin: groups.includes('Admin'),
    groups,
  };
}

async function requireAdmin() {
  const status = await getAdminStatus();
  if (!status.isAdmin) {
    throw new Error('Admin access required. Add this user to the Cognito Admin group.');
  }
  return status;
}

async function listListings() {
  await ensureReady();
  const Listing = requireModel('Listing');
  const { data, errors } = await Listing.list({
    filter: { status: { eq: 'ACTIVE' } },
  });
  if (errors?.length) throw new Error(errors[0].message || 'Could not load listings.');
  return Promise.all((data || []).filter(isAvailableListing).map(hydrateListing));
}

async function listOwnListings() {
  await ensureReady();
  const profile = await getProfile();
  const Listing = requireModel('Listing');
  const { data, errors } = await Listing.list({
    filter: { sellerSub: { eq: profile.sub } },
  });
  if (errors?.length) throw new Error(errors[0].message || 'Could not load your listings.');
  return Promise.all((data || []).filter(listing => listing.status !== 'HIDDEN' && availableQuantity(listing) > 0).map(hydrateListing));
}

async function createListing(input) {
  await ensureReady();
  const profile = await getProfile();
  requireDisplayName(profile);
  const Listing = requireModel('Listing');
  const { data, errors } = await Listing.create({
    title: input.title,
    description: input.description,
    price: input.price,
    category: input.category,
    condition: input.condition,
    imageUrls: input.imageUrls || [],
    sellerSub: profile.sub,
    sellerName: profile.displayName,
    sellerAvatarKey: profile.avatarKey || '',
    location: input.location || '',
    publicLocation: input.publicLocation || input.location || '',
    latitude: input.latitude,
    longitude: input.longitude,
    quantityAvailable: normalizeQuantity(input.quantityAvailable),
    quantitySold: 0,
    trustAcknowledgedAt: input.trustAcknowledgedAt || new Date().toISOString(),
    status: 'ACTIVE',
  });
  if (errors?.length) throw new Error(errors[0].message || 'Could not create listing.');
  return hydrateListing(data);
}

async function updateListing(input) {
  await ensureReady();
  const Listing = requireModel('Listing');
  const { data, errors } = await Listing.update({
    id: input.id,
    title: input.title,
    description: input.description,
    price: input.price,
    category: input.category,
    condition: input.condition,
    imageUrls: input.imageUrls || [],
    location: input.location || '',
    publicLocation: input.publicLocation || input.location || '',
    latitude: input.latitude,
    longitude: input.longitude,
    quantityAvailable: normalizeQuantity(input.quantityAvailable),
    trustAcknowledgedAt: input.trustAcknowledgedAt || new Date().toISOString(),
    editedAt: new Date().toISOString(),
  });
  if (errors?.length) throw new Error(errors[0].message || 'Could not update listing.');
  return hydrateListing(data);
}

async function deleteListing(id) {
  await ensureReady();
  const Listing = requireModel('Listing');
  const { errors } = await Listing.delete({ id });
  if (errors?.length) throw new Error(errors[0].message || 'Could not delete listing.');
  return true;
}

async function getListing(id) {
  await ensureReady();
  const Listing = requireModel('Listing');
  const { data, errors } = await Listing.get({ id });
  if (errors?.length) return null;
  return data ? hydrateListing(data) : null;
}

async function startConversation(listing, body) {
  await ensureReady();
  const profile = await getProfile();
  requireDisplayName(profile);
  if (profile.sub === listing.sellerSub) {
    throw new Error('You cannot message yourself about your own listing.');
  }

  const participantIds = [profile.sub, listing.sellerSub].filter(Boolean);
  const Conversation = requireModel('Conversation');
  const Message = requireModel('Message');
  const now = new Date().toISOString();
  const preview = body.slice(0, 140);

  const { data: conversation, errors: conversationErrors } = await Conversation.create({
    listingId: listing.id,
    listingTitle: listing.title || listing.itemName,
    buyerSub: profile.sub,
    buyerName: profile.displayName,
    buyerAvatarKey: profile.avatarKey || '',
    sellerSub: listing.sellerSub,
    sellerName: listing.sellerName || 'Seller',
    sellerAvatarKey: listing.sellerAvatarKey || '',
    participantIds,
    lastMessagePreview: preview,
    lastMessageAt: now,
  });
  if (conversationErrors?.length) throw new Error(conversationErrors[0].message || 'Could not start conversation.');

  const { errors: messageErrors } = await Message.create({
    conversationId: conversation.id,
    listingId: listing.id,
    senderSub: profile.sub,
    senderName: profile.displayName,
    senderAvatarKey: profile.avatarKey || '',
    recipientSub: listing.sellerSub,
    body,
    participantIds,
  });
  if (messageErrors?.length) throw new Error(messageErrors[0].message || 'Could not send message.');

  return conversation;
}

async function listConversations() {
  await ensureReady();
  const Conversation = requireModel('Conversation');
  const { data, errors } = await Conversation.list();
  if (errors?.length) throw new Error(errors[0].message || 'Could not load conversations.');
  return (data || [])
    .filter(conversation => !conversation.completedAt)
    .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
}

async function getConversation(id) {
  await ensureReady();
  const Conversation = requireModel('Conversation');
  const { data, errors } = await Conversation.get({ id });
  if (errors?.length) throw new Error(errors[0].message || 'Could not load conversation.');
  return data;
}

async function listMessages(conversationId) {
  await ensureReady();
  const Message = requireModel('Message');
  const { data, errors } = await Message.list({
    filter: { conversationId: { eq: conversationId } },
  });
  if (errors?.length) throw new Error(errors[0].message || 'Could not load messages.');
  return (data || []).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

async function sendMessage(conversation, body) {
  await ensureReady();
  const profile = await getProfile();
  requireDisplayName(profile);
  const participantIds = conversation.participantIds || [];
  const recipientSub = participantIds.find(id => id !== profile.sub);
  if (!recipientSub) throw new Error('Could not find the other participant.');

  const Message = requireModel('Message');
  const Conversation = requireModel('Conversation');
  const now = new Date().toISOString();
  const preview = body.slice(0, 140);

  const { data, errors } = await Message.create({
    conversationId: conversation.id,
    listingId: conversation.listingId,
    senderSub: profile.sub,
    senderName: profile.displayName,
    senderAvatarKey: profile.avatarKey || '',
    recipientSub,
    body,
    participantIds,
  });
  if (errors?.length) throw new Error(errors[0].message || 'Could not send message.');

  await Conversation.update({
    id: conversation.id,
    lastMessagePreview: preview,
    lastMessageAt: now,
  }).catch(() => {});

  return data;
}

async function completeOrder(conversation, options = {}) {
  await ensureReady();
  const profile = await getProfile();
  requireDisplayName(profile);
  const Conversation = requireModel('Conversation');
  const Listing = requireModel('Listing');
  const now = new Date().toISOString();
  const isBuyer = profile.sub === conversation.buyerSub;
  const isSeller = profile.sub === conversation.sellerSub;
  if (!isBuyer && !isSeller) throw new Error('Only conversation participants can complete this order.');
  const itemSelection = normalizeItemSelection(options.itemSelection);

  const next = {
    id: conversation.id,
    buyerItemSelection: conversation.buyerItemSelection,
    sellerItemSelection: conversation.sellerItemSelection,
    buyerCompletedAt: conversation.buyerCompletedAt,
    sellerCompletedAt: conversation.sellerCompletedAt,
  };

  if (isBuyer && !next.buyerCompletedAt) {
    next.buyerCompletedAt = now;
    next.buyerItemSelection = itemSelection;
  }
  if (isSeller && !next.sellerCompletedAt) {
    next.sellerCompletedAt = now;
    next.sellerItemSelection = itemSelection;
  }
  const finished = Boolean(next.buyerCompletedAt && next.sellerCompletedAt);
  if (finished && !conversation.completedAt) {
    if (normalizeItemSelection(next.buyerItemSelection) !== normalizeItemSelection(next.sellerItemSelection)) {
      throw new Error('Buyer and seller selected different items. Confirm the same item before completing the order.');
    }
    next.completedItemSelection = normalizeItemSelection(next.buyerItemSelection);
    next.completedAt = now;
  }

  const { data, errors } = await Conversation.update(next);
  if (errors?.length) throw new Error(errors[0].message || 'Could not complete order.');

  if (finished && !conversation.completedAt) {
    const listingResponse = await Listing.get({ id: conversation.listingId }).catch(() => ({ data: null }));
    const listing = listingResponse?.data;
    const nextQuantity = Math.max(0, availableQuantity(listing) - 1);
    const quantitySold = Math.max(0, Number(listing?.quantitySold || 0)) + 1;

    await Listing.update({
      id: conversation.listingId,
      quantityAvailable: nextQuantity,
      quantitySold,
      status: nextQuantity > 0 ? 'ACTIVE' : 'SOLD',
      soldAt: nextQuantity > 0 ? listing?.soldAt : now,
      buyerSub: conversation.buyerSub,
    }).catch(() => {});

    if (client?.models?.Order) {
      await client.models.Order.create({
        conversationId: conversation.id,
        listingId: conversation.listingId,
        listingTitle: conversation.listingTitle,
        listingDescription: listing?.description,
        listingImageUrl: listing?.imageUrls?.find(Boolean),
        buyerSub: conversation.buyerSub,
        buyerName: conversation.buyerName,
        sellerSub: conversation.sellerSub,
        sellerName: conversation.sellerName,
        participantIds: conversation.participantIds || [],
        price: listing?.price,
        quantity: 1,
        itemSelection: next.completedItemSelection,
        marketplaceFee: marketplaceFee(listing?.price),
        completedAt: now,
      }).catch(() => {});
    }
  }

  return data;
}

async function listOrders() {
  await ensureReady();
  const profile = await getProfile();
  const hydrateOrder = async order => ({
    ...order,
    listingImageUrl: await resolveImageUrl(order.listingImageUrl).catch(() => order.listingImageUrl),
  });
  if (client?.models?.Order) {
    const { data, errors } = await client.models.Order.list();
    if (errors?.length) throw new Error(errors[0].message || 'Could not load orders.');
    const orders = (data || [])
      .filter(order => (order.participantIds || []).includes(profile.sub))
      .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
    return Promise.all(orders.map(hydrateOrder));
  }
  const conversations = await listConversations();
  return conversations.filter(conversation => conversation.completedAt);
}

async function deleteConversation(id) {
  await ensureReady();
  const Conversation = requireModel('Conversation');
  const { errors } = await Conversation.delete({ id });
  if (errors?.length) throw new Error(errors[0].message || 'Could not clear conversation.');
  return true;
}

async function reportListing(input) {
  await ensureReady();
  const profile = await getProfile();
  requireDisplayName(profile);
  const ListingReport = requireModel('ListingReport');
  const reason = ['MISLEADING', 'SCAM', 'PROHIBITED', 'SPAM', 'OTHER'].includes(input.reason)
    ? input.reason
    : 'OTHER';
  const { data, errors } = await ListingReport.create({
    listingId: input.listingId,
    listingTitle: input.listingTitle || '',
    reporterSub: profile.sub,
    reporterName: profile.displayName,
    reason,
    notes: String(input.notes || '').trim().slice(0, 500),
    status: 'OPEN',
  });
  if (errors?.length) throw new Error(errors[0].message || 'Could not report listing.');
  return data;
}

async function hydrateReport(report) {
  if (!report) return report;
  const Listing = client?.models?.Listing;
  const listingResponse = report.listingId && Listing
    ? await Listing.get({ id: report.listingId }).catch(() => ({ data: null }))
    : { data: null };
  const adminNote = report.listingId ? await getListingAdminNote(report.listingId).catch(() => null) : null;
  return {
    ...report,
    listing: listingResponse?.data ? await hydrateListing(listingResponse.data).catch(() => listingResponse.data) : null,
    adminNote,
  };
}

async function listReports(status = 'ALL') {
  await ensureReady();
  await requireAdmin();
  const ListingReport = requireModel('ListingReport');
  const filter = status && status !== 'ALL' ? { status: { eq: status } } : undefined;
  const { data, errors } = await ListingReport.list(filter ? { filter } : undefined);
  if (errors?.length) throw new Error(errors[0].message || 'Could not load reports.');
  const reports = await Promise.all((data || []).map(hydrateReport));
  return reports.sort((a, b) => new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0));
}

async function updateReportStatus(id, status) {
  await ensureReady();
  await requireAdmin();
  const cleanStatus = ['OPEN', 'REVIEWED', 'RESOLVED'].includes(status) ? status : 'OPEN';
  const ListingReport = requireModel('ListingReport');
  const { data, errors } = await ListingReport.update({ id, status: cleanStatus });
  if (errors?.length) throw new Error(errors[0].message || 'Could not update report.');
  return data;
}

async function deleteReport(id) {
  await ensureReady();
  await requireAdmin();
  const ListingReport = requireModel('ListingReport');
  const { errors } = await ListingReport.delete({ id });
  if (errors?.length) throw new Error(errors[0].message || 'Could not clear report.');
  return true;
}

async function updateListingAdminNotes(listingId, adminNotes) {
  await ensureReady();
  await requireAdmin();
  const ListingAdminNote = requireModel('ListingAdminNote');
  const cleanNotes = String(adminNotes || '').trim().slice(0, 2000);
  const existing = await getListingAdminNote(listingId).catch(() => null);
  const result = existing
    ? await ListingAdminNote.update({ id: existing.id, notes: cleanNotes })
    : await ListingAdminNote.create({ listingId, notes: cleanNotes });
  if (result.errors?.length) throw new Error(result.errors[0].message || 'Could not save admin notes.');
  return result.data;
}

async function getListingAdminNote(listingId) {
  await ensureReady();
  await requireAdmin();
  const ListingAdminNote = requireModel('ListingAdminNote');
  const { data, errors } = await ListingAdminNote.list({
    filter: { listingId: { eq: listingId } },
  });
  if (errors?.length) throw new Error(errors[0].message || 'Could not load admin notes.');
  return data?.[0] || null;
}

async function deleteListingAsAdmin(listingId) {
  await ensureReady();
  await requireAdmin();
  const Listing = requireModel('Listing');
  const adminNote = await getListingAdminNote(listingId).catch(() => null);
  const { errors } = await Listing.delete({ id: listingId });
  if (errors?.length) throw new Error(errors[0].message || 'Could not delete listing.');
  if (adminNote?.id) {
    const ListingAdminNote = requireModel('ListingAdminNote');
    await ListingAdminNote.delete({ id: adminNote.id }).catch(() => null);
  }
  return true;
}

async function hideListingFromReport(report) {
  await ensureReady();
  await requireAdmin();
  if (!report?.listingId) throw new Error('Report is missing a listing id.');
  const Listing = requireModel('Listing');
  const { data, errors } = await Listing.update({
    id: report.listingId,
    status: 'HIDDEN',
    editedAt: new Date().toISOString(),
  });
  if (errors?.length) throw new Error(errors[0].message || 'Could not hide listing.');
  if (report.id) await updateReportStatus(report.id, 'REVIEWED').catch(() => null);
  return hydrateListing(data);
}

window.summitMarketplace = {
  completeOrder,
  createListing,
  deleteListing,
  deleteConversation,
  deleteListingAsAdmin,
  deleteReport,
  getConversation,
  getListing,
  getAdminStatus,
  getProfile,
  listConversations,
  listListings,
  listOrders,
  listOwnListings,
  listMessages,
  listReports,
  sendMessage,
  startConversation,
  updateListing,
  updateListingAdminNotes,
  updateDisplayName,
  updateProfileAvatar,
  updateReportStatus,
  uploadImage,
  resolveImageUrl,
  reportListing,
  hideListingFromReport,
};

window.dispatchEvent(new Event('summitMarketplaceReady'));
