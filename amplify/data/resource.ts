import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  ListingStatus: a.enum(['ACTIVE', 'SOLD', 'HIDDEN']),
  ListingCondition: a.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR']),
  ListingReportReason: a.enum(['MISLEADING', 'SCAM', 'PROHIBITED', 'SPAM', 'OTHER']),
  ListingReportStatus: a.enum(['OPEN', 'REVIEWED', 'RESOLVED']),

  Listing: a
    .model({
      title: a.string().required(),
      description: a.string().required(),
      price: a.integer().required(),
      category: a.string().required(),
      condition: a.ref('ListingCondition').required(),
      imageUrls: a.string().array(),
      sellerSub: a.string().required(),
      sellerName: a.string(),
      sellerAvatarKey: a.string(),
      sellerEmail: a.email(),
      location: a.string(),
      publicLocation: a.string(),
      latitude: a.float(),
      longitude: a.float(),
      quantityAvailable: a.integer(),
      quantitySold: a.integer(),
      trustAcknowledgedAt: a.datetime(),
      status: a.ref('ListingStatus').required(),
      editedAt: a.datetime(),
      soldAt: a.datetime(),
      buyerSub: a.string(),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.ownerDefinedIn('sellerSub').identityClaim('sub'),
      allow.authenticated().to(['read']),
      allow.group('Admin').to(['read', 'update']),
    ]),

  Conversation: a
    .model({
      listingId: a.id().required(),
      listingTitle: a.string().required(),
      buyerSub: a.string().required(),
      buyerName: a.string(),
      buyerAvatarKey: a.string(),
      sellerSub: a.string().required(),
      sellerName: a.string(),
      sellerAvatarKey: a.string(),
      participantIds: a.string().array().required(),
      lastMessagePreview: a.string(),
      lastMessageAt: a.datetime(),
      buyerCompletedAt: a.datetime(),
      sellerCompletedAt: a.datetime(),
      completedAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('participantIds').identityClaim('sub'),
    ]),

  Message: a
    .model({
      conversationId: a.id().required(),
      listingId: a.id().required(),
      senderSub: a.string().required(),
      senderName: a.string(),
      senderAvatarKey: a.string(),
      recipientSub: a.string().required(),
      body: a.string().required(),
      participantIds: a.string().array().required(),
      readAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('participantIds').identityClaim('sub'),
    ]),

  Order: a
    .model({
      conversationId: a.id(),
      listingId: a.id().required(),
      listingTitle: a.string().required(),
      listingDescription: a.string(),
      listingImageUrl: a.string(),
      buyerSub: a.string().required(),
      buyerName: a.string(),
      sellerSub: a.string().required(),
      sellerName: a.string(),
      sellerAvatarKey: a.string(),
      participantIds: a.string().array().required(),
      price: a.integer(),
      quantity: a.integer(),
      marketplaceFee: a.integer(),
      completedAt: a.datetime().required(),
    })
    .authorization((allow) => [
      allow.ownersDefinedIn('participantIds').identityClaim('sub'),
      allow.authenticated().to(['read']),
    ]),

  ListingReport: a
    .model({
      listingId: a.id().required(),
      listingTitle: a.string(),
      reporterSub: a.string().required(),
      reporterName: a.string(),
      reason: a.ref('ListingReportReason').required(),
      notes: a.string(),
      status: a.ref('ListingReportStatus').required(),
    })
    .authorization((allow) => [
      allow.ownerDefinedIn('reporterSub').identityClaim('sub').to(['create', 'read']),
      allow.group('Admin').to(['read', 'update', 'delete']),
    ]),

  UserProfile: a
    .model({
      userSub: a.string().required(),
      displayName: a.string().required(),
      avatarKey: a.string(),
    })
    .authorization((allow) => [
      allow.ownerDefinedIn('userSub').identityClaim('sub'),
      allow.authenticated().to(['read']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
