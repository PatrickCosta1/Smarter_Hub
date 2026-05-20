import { findUserByIdWithProfile, findCollaboratorsList } from '../../repositories/users/get-users.repository.js';

export async function getUserById(userId: string) {
  const user = await findUserByIdWithProfile(userId);

  if (!user) {
    throw new Error('User not found');
  }

  return user;
}

export async function getUserProfile(userId: string) {
  const user = await findUserByIdWithProfile(userId);

  if (!user || !user.profile) {
    throw new Error('User or profile not found');
  }

  return {
    user,
    profile: user.profile,
  };
}

export async function listCollaborators(filters: {
  skip: number;
  limit: number;
  search?: string;
  role?: string;
  teamId?: string;
  workCountry?: string;
}) {
  return findCollaboratorsList(filters);
}
