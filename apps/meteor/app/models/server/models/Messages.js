import { Match } from 'meteor/check';
import _ from 'underscore';

import { Base } from './_Base';
import Rooms from './Rooms';
import { settings } from '../../../settings/server';

export class Messages extends Base {
	constructor() {
		super('message');

		this.tryEnsureIndex({ rid: 1, ts: 1, _updatedAt: 1 });
		this.tryEnsureIndex({ ts: 1 });
		this.tryEnsureIndex({ 'u._id': 1 });
		this.tryEnsureIndex({ editedAt: 1 }, { sparse: true });
		this.tryEnsureIndex({ 'editedBy._id': 1 }, { sparse: true });
		this.tryEnsureIndex({ 'rid': 1, 't': 1, 'u._id': 1 });
		this.tryEnsureIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
		this.tryEnsureIndex({ msg: 'text' });
		this.tryEnsureIndex({ 'file._id': 1 }, { sparse: true });
		this.tryEnsureIndex({ 'mentions.username': 1 }, { sparse: true });
		this.tryEnsureIndex({ pinned: 1 }, { sparse: true });
		this.tryEnsureIndex({ location: '2dsphere' });
		this.tryEnsureIndex({ slackTs: 1, slackBotId: 1 }, { sparse: true });
		this.tryEnsureIndex({ unread: 1 }, { sparse: true });

		// discussions
		this.tryEnsureIndex({ drid: 1 }, { sparse: true });
		// threads
		this.tryEnsureIndex({ tmid: 1 }, { sparse: true });
		this.tryEnsureIndex({ tcount: 1, tlm: 1 }, { sparse: true });
		this.tryEnsureIndex({ rid: 1, tlm: -1 }, { partialFilterExpression: { tcount: { $exists: true } } }); // used for the List Threads
		this.tryEnsureIndex({ rid: 1, tcount: 1 }); // used for the List Threads Count
		// livechat
		this.tryEnsureIndex({ 'navigation.token': 1 }, { sparse: true });
	}

	setReactions(messageId, reactions) {
		return this.update({ _id: messageId }, { $set: { reactions } });
	}

	createRoomArchivedByRoomIdAndUser(roomId, user) {
		return this.createWithTypeRoomIdMessageAndUser('room-archived', roomId, '', user);
	}

	createRoomUnarchivedByRoomIdAndUser(roomId, user) {
		return this.createWithTypeRoomIdMessageAndUser('room-unarchived', roomId, '', user);
	}

	createRoomSetReadOnlyByRoomIdAndUser(roomId, user) {
		return this.createWithTypeRoomIdMessageAndUser('room-set-read-only', roomId, '', user);
	}

	createRoomRemovedReadOnlyByRoomIdAndUser(roomId, user) {
		return this.createWithTypeRoomIdMessageAndUser('room-removed-read-only', roomId, '', user);
	}

	createRoomAllowedReactingByRoomIdAndUser(roomId, user) {
		return this.createWithTypeRoomIdMessageAndUser('room-allowed-reacting', roomId, '', user);
	}

	createRoomDisallowedReactingByRoomIdAndUser(roomId, user) {
		return this.createWithTypeRoomIdMessageAndUser('room-disallowed-reacting', roomId, '', user);
	}

	unsetReactions(messageId) {
		return this.update({ _id: messageId }, { $unset: { reactions: 1 } });
	}

	updateOTRAck(_id, otrAck) {
		const query = { _id };
		const update = { $set: { otrAck } };
		return this.update(query, update);
	}

	createRoomSettingsChangedWithTypeRoomIdMessageAndUser(type, roomId, message, user, extraData) {
		return this.createWithTypeRoomIdMessageAndUser(type, roomId, message, user, extraData);
	}

	createRoomRenamedWithRoomIdRoomNameAndUser(roomId, roomName, user, extraData) {
		return this.createWithTypeRoomIdMessageAndUser('r', roomId, roomName, user, extraData);
	}

	addTranslations(messageId, translations, providerName) {
		const updateObj = { translationProvider: providerName };
		Object.keys(translations).forEach((key) => {
			const translation = translations[key];
			updateObj[`translations.${key}`] = translation;
		});
		return this.update({ _id: messageId }, { $set: updateObj });
	}

	addAttachmentTranslations = function (messageId, attachmentIndex, translations) {
		const updateObj = {};
		Object.keys(translations).forEach((key) => {
			const translation = translations[key];
			updateObj[`attachments.${attachmentIndex}.translations.${key}`] = translation;
		});
		return this.update({ _id: messageId }, { $set: updateObj });
	};

	setImportFileRocketChatAttachment(importFileId, rocketChatUrl, attachment) {
		const query = {
			'_importFile.id': importFileId,
		};

		return this.update(
			query,
			{
				$set: {
					'_importFile.rocketChatUrl': rocketChatUrl,
					'_importFile.downloaded': true,
				},
				$addToSet: {
					attachments: attachment,
				},
			},
			{ multi: true },
		);
	}

	// FIND
	findByMention(username, options) {
		const query = { 'mentions.username': username };

		return this.find(query, options);
	}

	findFilesByUserId(userId, options = {}) {
		const query = {
			'u._id': userId,
			'file._id': { $exists: true },
		};
		return this.find(query, { fields: { 'file._id': 1 }, ...options });
	}

	findFilesByRoomIdPinnedTimestampAndUsers(
		rid,
		excludePinned,
		ignoreDiscussion = true,
		ts,
		users = [],
		ignoreThreads = true,
		options = {},
	) {
		const query = {
			rid,
			ts,
			'file._id': { $exists: true },
		};

		if (excludePinned) {
			query.pinned = { $ne: true };
		}

		if (ignoreThreads) {
			query.tmid = { $exists: 0 };
			query.tcount = { $exists: 0 };
		}

		if (ignoreDiscussion) {
			query.drid = { $exists: 0 };
		}

		if (users.length) {
			query['u.username'] = { $in: users };
		}

		return this.find(query, { fields: { 'file._id': 1 }, ...options });
	}

	findDiscussionByRoomIdPinnedTimestampAndUsers(rid, excludePinned, ts, users = [], options = {}) {
		const query = {
			rid,
			ts,
			drid: { $exists: 1 },
		};

		if (excludePinned) {
			query.pinned = { $ne: true };
		}

		if (users.length) {
			query['u.username'] = { $in: users };
		}

		return this.find(query, options);
	}

	findVisibleByRoomIdNotContainingTypes(roomId, types, options, showThreadMessages = true) {
		const query = {
			_hidden: {
				$ne: true,
			},
			rid: roomId,
			...(!showThreadMessages && {
				$or: [
					{
						tmid: { $exists: false },
					},
					{
						tshow: true,
					},
				],
			}),
		};

		if (Match.test(types, [String]) && types.length > 0) {
			query.t = { $nin: types };
		}

		return this.find(query, options);
	}

	findForUpdates(roomId, timestamp, options) {
		const query = {
			_hidden: {
				$ne: true,
			},
			rid: roomId,
			_updatedAt: {
				$gt: timestamp,
			},
		};
		return this.find(query, options);
	}

	findVisibleByRoomIdBeforeTimestampNotContainingTypes(roomId, timestamp, types, options, showThreadMessages = true, inclusive = false) {
		const query = {
			_hidden: {
				$ne: true,
			},
			rid: roomId,
			ts: {
				[inclusive ? '$lte' : '$lt']: timestamp,
			},
			...(!showThreadMessages && {
				$or: [
					{
						tmid: { $exists: false },
					},
					{
						tshow: true,
					},
				],
			}),
		};

		if (Match.test(types, [String]) && types.length > 0) {
			query.t = { $nin: types };
		}

		return this.find(query, options);
	}

	findVisibleByRoomIdBetweenTimestampsNotContainingTypes(
		roomId,
		afterTimestamp,
		beforeTimestamp,
		types,
		options,
		showThreadMessages = true,
		inclusive = false,
	) {
		const query = {
			_hidden: {
				$ne: true,
			},
			rid: roomId,
			ts: {
				[inclusive ? '$gte' : '$gt']: afterTimestamp,
				[inclusive ? '$lte' : '$lt']: beforeTimestamp,
			},
			...(!showThreadMessages && {
				$or: [
					{
						tmid: { $exists: false },
					},
					{
						tshow: true,
					},
				],
			}),
		};

		if (Match.test(types, [String]) && types.length > 0) {
			query.t = { $nin: types };
		}

		return this.find(query, options);
	}

	findByRoomIdAndMessageIds(rid, messageIds, options) {
		const query = {
			rid,
			_id: {
				$in: messageIds,
			},
		};

		return this.find(query, options);
	}

	findOneBySlackBotIdAndSlackTs(slackBotId, slackTs) {
		const query = {
			slackBotId,
			slackTs,
		};

		return this.findOne(query);
	}

	findOneBySlackTs(slackTs) {
		const query = { slackTs };

		return this.findOne(query);
	}

	findByRoomId(roomId, options) {
		const query = {
			rid: roomId,
		};

		return this.find(query, options);
	}

	getLastVisibleMessageSentWithNoTypeByRoomId(rid, messageId) {
		const query = {
			rid,
			_hidden: { $ne: true },
			t: { $exists: false },
			$or: [{ tmid: { $exists: false } }, { tshow: true }],
		};

		if (messageId) {
			query._id = { $ne: messageId };
		}

		const options = {
			sort: {
				ts: -1,
			},
		};

		return this.findOne(query, options);
	}

	setUrlsById(_id, urls) {
		const query = { _id };

		const update = {
			$set: {
				urls,
			},
		};

		return this.update(query, update);
	}

	updateAllUsernamesByUserId(userId, username) {
		const query = { 'u._id': userId };

		const update = {
			$set: {
				'u.username': username,
			},
		};

		return this.update(query, update, { multi: true });
	}

	updateUsernameOfEditByUserId(userId, username) {
		const query = { 'editedBy._id': userId };

		const update = {
			$set: {
				'editedBy.username': username,
			},
		};

		return this.update(query, update, { multi: true });
	}

	updateUsernameAndMessageOfMentionByIdAndOldUsername(_id, oldUsername, newUsername, newMessage) {
		const query = {
			_id,
			'mentions.username': oldUsername,
		};

		const update = {
			$set: {
				'mentions.$.username': newUsername,
				'msg': newMessage,
			},
		};

		return this.update(query, update);
	}

	upgradeEtsToEditAt() {
		const query = { ets: { $exists: 1 } };

		const update = {
			$rename: {
				ets: 'editedAt',
			},
		};

		return this.update(query, update, { multi: true });
	}

	setMessageAttachments(_id, attachments) {
		const query = { _id };

		const update = {
			$set: {
				attachments,
			},
		};

		return this.update(query, update);
	}

	setSlackBotIdAndSlackTs(_id, slackBotId, slackTs) {
		const query = { _id };

		const update = {
			$set: {
				slackBotId,
				slackTs,
			},
		};

		return this.update(query, update);
	}

	unlinkUserId(userId, newUserId, newUsername, newNameAlias) {
		const query = {
			'u._id': userId,
		};

		const update = {
			$set: {
				'alias': newNameAlias,
				'u._id': newUserId,
				'u.username': newUsername,
				'u.name': undefined,
			},
		};

		return this.update(query, update, { multi: true });
	}

	// INSERT
	/**
	 * @returns {Pick<IMessage, '_id' | 't' | 'rid' | 'ts' | 'msg' | 'u' | 'groupable' | 'unread'>}
	 */
	createWithTypeRoomIdMessageAndUser(type, roomId, message, user, extraData) {
		const record = {
			t: type,
			rid: roomId,
			ts: new Date(),
			msg: message,
			u: {
				_id: user._id,
				username: user.username,
			},
			groupable: false,
		};

		if (settings.get('Message_Read_Receipt_Enabled')) {
			record.unread = true;
		}

		_.extend(record, extraData);

		record._id = this.insertOrUpsert(record);
		Rooms.incMsgCountById(roomId, 1);
		return record;
	}

	createNavigationHistoryWithRoomIdMessageAndUser(roomId, message, user, extraData) {
		const type = 'livechat_navigation_history';
		const record = {
			t: type,
			rid: roomId,
			ts: new Date(),
			msg: message,
			u: {
				_id: user._id,
				username: user.username,
			},
			groupable: false,
		};

		if (settings.get('Message_Read_Receipt_Enabled')) {
			record.unread = true;
		}

		_.extend(record, extraData);

		record._id = this.insertOrUpsert(record);
		return record;
	}

	createTranscriptHistoryWithRoomIdMessageAndUser(roomId, message, user, extraData) {
		const type = 'livechat_transcript_history';
		const record = {
			t: type,
			rid: roomId,
			ts: new Date(),
			msg: message,
			u: {
				_id: user._id,
				username: user.username,
			},
			groupable: false,
		};

		if (settings.get('Message_Read_Receipt_Enabled')) {
			record.unread = true;
		}
		Object.assign(record, extraData);

		record._id = this.insertOrUpsert(record);
		return record;
	}

	createUserJoinWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('uj', roomId, message, user, extraData);
	}

	createUserJoinTeamWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('ujt', roomId, message, user, extraData);
	}

	createUserJoinWithRoomIdAndUserDiscussion(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('ut', roomId, message, user, extraData);
	}

	createUserLeaveWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('ul', roomId, message, user, extraData);
	}

	createUserLeaveTeamWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('ult', roomId, message, user, extraData);
	}

	createUserConvertChannelToTeamWithRoomIdAndUser(roomId, roomName, user, extraData) {
		return this.createWithTypeRoomIdMessageAndUser('user-converted-to-team', roomId, roomName, user, extraData);
	}

	createUserConvertTeamToChannelWithRoomIdAndUser(roomId, roomName, user, extraData) {
		return this.createWithTypeRoomIdMessageAndUser('user-converted-to-channel', roomId, roomName, user, extraData);
	}

	createUserRemoveRoomFromTeamWithRoomIdAndUser(roomId, roomName, user, extraData) {
		return this.createWithTypeRoomIdMessageAndUser('user-removed-room-from-team', roomId, roomName, user, extraData);
	}

	createUserDeleteRoomFromTeamWithRoomIdAndUser(roomId, roomName, user, extraData) {
		return this.createWithTypeRoomIdMessageAndUser('user-deleted-room-from-team', roomId, roomName, user, extraData);
	}

	createUserAddRoomToTeamWithRoomIdAndUser(roomId, roomName, user, extraData) {
		return this.createWithTypeRoomIdMessageAndUser('user-added-room-to-team', roomId, roomName, user, extraData);
	}

	createUserRemovedWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('ru', roomId, message, user, extraData);
	}

	createUserRemovedFromTeamWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('removed-user-from-team', roomId, message, user, extraData);
	}

	createUserAddedWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('au', roomId, message, user, extraData);
	}

	createUserAddedToTeamWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('added-user-to-team', roomId, message, user, extraData);
	}

	createCommandWithRoomIdAndUser(command, roomId, user, extraData) {
		return this.createWithTypeRoomIdMessageAndUser('command', roomId, command, user, extraData);
	}

	createUserMutedWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('user-muted', roomId, message, user, extraData);
	}

	createUserUnmutedWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('user-unmuted', roomId, message, user, extraData);
	}

	createNewModeratorWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('new-moderator', roomId, message, user, extraData);
	}

	createModeratorRemovedWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('moderator-removed', roomId, message, user, extraData);
	}

	createNewOwnerWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('new-owner', roomId, message, user, extraData);
	}

	createOwnerRemovedWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('owner-removed', roomId, message, user, extraData);
	}

	createNewLeaderWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('new-leader', roomId, message, user, extraData);
	}

	createLeaderRemovedWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('leader-removed', roomId, message, user, extraData);
	}

	createSubscriptionRoleAddedWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('subscription-role-added', roomId, message, user, extraData);
	}

	createSubscriptionRoleRemovedWithRoomIdAndUser(roomId, user, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser('subscription-role-removed', roomId, message, user, extraData);
	}

	createOtrSystemMessagesWithRoomIdAndUser(roomId, user, id, extraData) {
		const message = user.username;
		return this.createWithTypeRoomIdMessageAndUser(id, roomId, message, user, extraData);
	}

	// REMOVE
	removeById(_id) {
		const query = { _id };

		return this.remove(query);
	}

	removeByRoomId(roomId) {
		const query = { rid: roomId };

		return this.remove(query);
	}

	removeByRoomIds(rids) {
		return this.remove({ rid: { $in: rids } });
	}

	findThreadsByRoomIdPinnedTimestampAndUsers({ rid, pinned, ignoreDiscussion = true, ts, users = [] }, options) {
		const query = {
			rid,
			ts,
			tlm: { $exists: 1 },
			tcount: { $exists: 1 },
		};

		if (pinned) {
			query.pinned = { $ne: true };
		}

		if (ignoreDiscussion) {
			query.drid = { $exists: 0 };
		}

		if (users.length > 0) {
			query['u.username'] = { $in: users };
		}

		return this.find(query, options);
	}

	removeByIdPinnedTimestampLimitAndUsers(rid, pinned, ignoreDiscussion = true, ts, limit, users = [], ignoreThreads = true) {
		const query = {
			rid,
			ts,
		};

		if (pinned) {
			query.pinned = { $ne: true };
		}

		if (ignoreDiscussion) {
			query.drid = { $exists: 0 };
		}

		if (ignoreThreads) {
			query.tmid = { $exists: 0 };
			query.tcount = { $exists: 0 };
		}

		if (users.length) {
			query['u.username'] = { $in: users };
		}

		if (!limit) {
			const count = this.remove(query);

			// decrease message count
			Rooms.decreaseMessageCountById(rid, count);

			return count;
		}

		const messagesToDelete = this.find(query, {
			fields: {
				_id: 1,
			},
			limit,
		}).map(({ _id }) => _id);

		const count = this.remove({
			_id: {
				$in: messagesToDelete,
			},
		});

		// decrease message count
		Rooms.decreaseMessageCountById(rid, count);

		return count;
	}

	removeByUserId(userId) {
		const query = { 'u._id': userId };

		return this.remove(query);
	}

	getMessageByFileId(fileID) {
		return this.findOne({ 'file._id': fileID });
	}

	getMessageByFileIdAndUsername(fileID, userId) {
		const query = {
			'file._id': fileID,
			'u._id': userId,
		};

		const options = {
			fields: {
				unread: 0,
				mentions: 0,
				channels: 0,
				groupable: 0,
			},
		};

		return this.findOne(query, options);
	}

	setVisibleMessagesAsRead(rid, until) {
		return this.update(
			{
				rid,
				unread: true,
				ts: { $lt: until },
				$or: [
					{
						tmid: { $exists: false },
					},
					{
						tshow: true,
					},
				],
			},
			{
				$unset: {
					unread: 1,
				},
			},
			{
				multi: true,
			},
		);
	}

	setThreadMessagesAsRead(tmid, until) {
		return this.update(
			{
				tmid,
				unread: true,
				ts: { $lt: until },
			},
			{
				$unset: {
					unread: 1,
				},
			},
			{
				multi: true,
			},
		);
	}

	setAsReadById(_id) {
		return this.update(
			{
				_id,
			},
			{
				$unset: {
					unread: 1,
				},
			},
		);
	}

	findVisibleUnreadMessagesByRoomAndDate(rid, after) {
		const query = {
			unread: true,
			rid,
			$or: [
				{
					tmid: { $exists: false },
				},
				{
					tshow: true,
				},
			],
		};

		if (after) {
			query.ts = { $gt: after };
		}

		return this.find(query, {
			fields: {
				_id: 1,
			},
		});
	}

	findUnreadThreadMessagesByDate(tmid, userId, after) {
		const query = {
			'u._id': { $ne: userId },
			'unread': true,
			tmid,
			'tshow': { $exists: false },
		};

		if (after) {
			query.ts = { $gt: after };
		}

		return this.find(query, {
			fields: {
				_id: 1,
			},
		});
	}

	/**
	 * Copy metadata from the discussion to the system message in the parent channel
	 * which links to the discussion.
	 * Since we don't pass this metadata into the model's function, it is not a subject
	 * to race conditions: If multiple updates occur, the current state will be updated
	 * only if the new state of the discussion room is really newer.
	 */
	refreshDiscussionMetadata({ rid }) {
		if (!rid) {
			return false;
		}
		const { lm: dlm, msgs: dcount } = Rooms.findOneById(rid, {
			fields: {
				msgs: 1,
				lm: 1,
			},
		});

		const query = {
			drid: rid,
		};

		return this.update(
			query,
			{
				$set: {
					dcount,
					dlm,
				},
			},
			{ multi: 1 },
		);
	}

	// //////////////////////////////////////////////////////////////////
	// threads

	countThreads() {
		return this.find({ tcount: { $exists: true } }).count();
	}

	removeThreadRefByThreadId(tmid) {
		const query = { tmid };
		const update = {
			$unset: {
				tmid: 1,
			},
		};
		return this.update(query, update, { multi: true });
	}

	updateRepliesByThreadId(tmid, replies, ts) {
		const query = {
			_id: tmid,
		};

		const update = {
			$addToSet: {
				replies: {
					$each: replies,
				},
			},
			$set: {
				tlm: ts,
			},
			$inc: {
				tcount: 1,
			},
		};

		return this.update(query, update);
	}

	getThreadFollowsByThreadId(tmid) {
		const msg = this.findOneById(tmid, { fields: { replies: 1 } });
		return msg && msg.replies;
	}

	getFirstReplyTsByThreadId(tmid) {
		return this.findOne({ tmid }, { fields: { ts: 1 }, sort: { ts: 1 } });
	}

	unsetThreadByThreadId(tmid) {
		const query = {
			_id: tmid,
		};

		const update = {
			$unset: {
				tcount: 1,
				tlm: 1,
				replies: 1,
			},
		};

		return this.update(query, update);
	}

	updateThreadLastMessageAndCountByThreadId(tmid, tlm, tcount) {
		const query = {
			_id: tmid,
		};

		const update = {
			$set: {
				tlm,
			},
			$inc: {
				tcount,
			},
		};

		return this.update(query, update);
	}

	addThreadFollowerByThreadId(tmid, userId) {
		const query = {
			_id: tmid,
		};

		const update = {
			$addToSet: {
				replies: userId,
			},
		};

		return this.update(query, update);
	}

	removeThreadFollowerByThreadId(tmid, userId) {
		const query = {
			_id: tmid,
		};

		const update = {
			$pull: {
				replies: userId,
			},
		};

		return this.update(query, update);
	}

	findThreadsByRoomId(rid, skip, limit) {
		return this.find({ rid, tcount: { $exists: true } }, { sort: { tlm: -1 }, skip, limit });
	}

	findAgentLastMessageByVisitorLastMessageTs(roomId, visitorLastMessageTs) {
		const query = {
			rid: roomId,
			ts: { $gt: visitorLastMessageTs },
			token: { $exists: false },
		};

		return this.findOne(query, { sort: { ts: 1 } });
	}

	findAllImportedMessagesWithFilesToDownload() {
		const query = {
			'_importFile.downloadUrl': {
				$exists: true,
			},
			'_importFile.rocketChatUrl': {
				$exists: false,
			},
			'_importFile.downloaded': {
				$ne: true,
			},
			'_importFile.external': {
				$ne: true,
			},
		};

		return this.find(query);
	}

	decreaseReplyCountById(_id, inc = -1) {
		const query = { _id };
		const update = {
			$inc: {
				tcount: inc,
			},
		};
		return this.update(query, update);
	}
}

export default new Messages();
