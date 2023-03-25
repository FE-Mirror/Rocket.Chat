import { Accounts } from 'meteor/accounts-base';
import { Users } from '@rocket.chat/models';
import type { IUser } from '@rocket.chat/core-typings';
import type { Request } from 'express';

export async function getLoggedInUser(request: Request): Promise<Pick<IUser, '_id' | 'username'> | null> {
	const token = request.headers['x-auth-token'];
	const userId = request.headers['x-user-id'];
	if (!token || !userId || typeof token !== 'string' || typeof userId !== 'string') {
		return null;
	}

	return Users.findOneByIdAndLoginToken(userId, Accounts._hashLoginToken(token), { projection: { username: 1 } });
}
