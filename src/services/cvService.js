import { randomUUID } from 'node:crypto';
import { cvError, profileFields, validatePdf } from '../domain/cvRules.js';

export function profileResponse(profile) {

  if (!profile) return null;
  const { fields, publicId, attachment } = profile;
  return { ...profileFields(fields), publicId,
    attachment: attachment ? { name: attachment.name, size: attachment.size } : null };
}

async function discard(storage, key) {
  if (!key) return;
  try {
    await storage.remove(key);
  } catch {
    console.error('Unable to clean up a CV storage object.');
  }
}

export async function updateProfile(db, storage, ownerId, input, file) {
  const fields = profileFields(input);

  if (input.removeCv !== undefined && input.removeCv !== 'on') throw cvError('Invalid CV removal field.');
  const remove = input.removeCv === 'on';

  if (remove && file) throw cvError('Choose either a replacement PDF or removal.');
  const attachment = file && { ...validatePdf(file), key: `profiles/${ownerId}/${randomUUID()}.pdf` };

  let saved;

  try {
    if (attachment) await storage.upload(attachment.key, file.buffer);
    saved = await db.saveProfile(ownerId, fields, attachment || (remove ? { remove: true } : undefined));

  } catch (error) {
    // A lost commit acknowledgement may leave the new object referenced
    if (!error.commitUncertain) await discard(storage, attachment?.key);
    throw error;
  }

  await discard(storage, saved.retiredKey);
  return profileResponse(saved.profile);
}
