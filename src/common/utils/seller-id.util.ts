import { Model, Types } from 'mongoose';
import { SellerDocument } from '../../sellers/schemas/seller.schema';
import { UserDocument } from '../../users/schemas/user.schema';

export function getSellerObjectIdString(seller: SellerDocument): string {
  const id = seller?._id as Types.ObjectId | string | undefined;
  return typeof id === 'string' ? id : id?.toString?.() ?? '';
}

export function getSellerIdAliases(
  seller: SellerDocument,
  requestedId?: string,
): string[] {
  const aliases = new Set<string>();
  const objectId = getSellerObjectIdString(seller);
  if (objectId) aliases.add(objectId);
  if (typeof seller.publicId === 'string' && seller.publicId.trim()) {
    aliases.add(seller.publicId.trim());
  }
  if (typeof requestedId === 'string' && requestedId.trim()) {
    aliases.add(requestedId.trim());
  }
  return Array.from(aliases);
}

export async function findSellerUserByIdentifier(
  userModel: Model<UserDocument>,
  identifier: string,
) {
  const value = String(identifier ?? '').trim();
  if (!value) return null;
  if (Types.ObjectId.isValid(value)) {
    const byId = await userModel
      .findOne({ _id: value, role: 'seller' })
      .lean()
      .exec();
    if (byId) return byId;
  }
  return userModel
    .findOne({
      role: 'seller',
      $or: [{ publicId: value }, { email: value }, { username: value }],
    })
    .lean()
    .exec();
}

export async function findSellerByIdentifier(
  sellerModel: Model<SellerDocument>,
  userModel: Model<UserDocument>,
  identifier: string,
): Promise<SellerDocument | null> {
  const value = String(identifier ?? '').trim();
  if (!value) return null;
  if (Types.ObjectId.isValid(value)) {
    const sellerById = await sellerModel.findById(value).exec();
    if (sellerById) return sellerById;
  }
  const sellerByPublicId = await sellerModel.findOne({ publicId: value }).exec();
  if (sellerByPublicId) return sellerByPublicId;

  const user = await findSellerUserByIdentifier(userModel, value);
  if (!user) return null;
  if (user.sellerId) {
    const byLink = await sellerModel.findById(user.sellerId).exec();
    if (byLink) return byLink;
  }
  const email = String(user.email ?? '').trim().toLowerCase();
  if (!email) return null;
  return sellerModel
    .findOne({
      $or: [{ email }, { username: email }],
    })
    .exec();
}

export async function resolveSellerIdAliases(
  sellerModel: Model<SellerDocument>,
  userModel: Model<UserDocument>,
  identifier?: string,
): Promise<string[]> {
  const value = String(identifier ?? '').trim();
  if (!value) return [];
  const seller = await findSellerByIdentifier(sellerModel, userModel, value);
  if (seller) {
    return getSellerIdAliases(seller, value);
  }
  return [value];
}

export function buildGstIdFilter(gstId: string): { gstId: { $in: string[] } } {
  const values = new Set<string>([gstId]);
  if (Types.ObjectId.isValid(gstId)) {
    values.add(new Types.ObjectId(gstId).toString());
  }
  return { gstId: { $in: Array.from(values) } };
}

export function buildGstIdsFilter(gstIds: string[]): { gstId: { $in: string[] } } {
  const values = new Set<string>();
  for (const gstId of gstIds) {
    const trimmed = String(gstId ?? '').trim();
    if (!trimmed) continue;
    values.add(trimmed);
    if (Types.ObjectId.isValid(trimmed)) {
      values.add(new Types.ObjectId(trimmed).toString());
    }
  }
  return { gstId: { $in: Array.from(values) } };
}
