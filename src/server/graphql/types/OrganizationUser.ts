import {GraphQLBoolean, GraphQLID, GraphQLNonNull, GraphQLObjectType} from 'graphql'
import GraphQLISO8601Type from 'server/graphql/types/GraphQLISO8601Type'
import OrgUserRoleEnum from 'server/graphql/types/OrgUserRoleEnum'
import User from 'server/graphql/types/User'
import Organization from 'server/graphql/types/Organization'
import {resolveOrganization, resolveUser} from 'server/graphql/resolvers'
import connectionDefinitions from 'server/graphql/connectionDefinitions'

const OrganizationUser = new GraphQLObjectType({
  name: 'OrganizationUser',
  description: 'organization-specific details about a user',
  fields: () => ({
    id: {
      type: new GraphQLNonNull(GraphQLID),
      description: 'orgId::userId'
    },
    inactive: {
      type: new GraphQLNonNull(GraphQLBoolean),
      description: 'true if the user is paused and the orgs are not being billed, else false',
      resolve: ({inactive}) => !!inactive
    },
    joinedAt: {
      type: new GraphQLNonNull(GraphQLISO8601Type),
      description: 'the datetime the user first joined the org'
    },
    newUserUntil: {
      type: new GraphQLNonNull(GraphQLISO8601Type),
      description:
        'The last moment a billing leader can remove the user from the org & receive a refund. Set to the subscription periodEnd'
    },
    newUserRefundAppliedAt: {
      type: GraphQLISO8601Type,
      description: 'the datetime the user was removed from the organization if they were a new user'
    },
    orgId: {
      type: new GraphQLNonNull(GraphQLID),
      description: 'FK'
    },
    organization: {
      type: new GraphQLNonNull(Organization),
      description: 'The user attached to the organization',
      resolve: resolveOrganization
    },
    removedAt: {
      type: GraphQLISO8601Type,
      description: 'if not a member, the datetime the user was removed from the org'
    },
    role: {
      type: OrgUserRoleEnum,
      description: 'role of the user in the org'
    },
    userId: {
      type: new GraphQLNonNull(GraphQLID),
      description: 'FK'
    },
    user: {
      type: new GraphQLNonNull(User),
      description: 'The user attached to the organization',
      resolve: resolveUser
    }
  })
})

const {connectionType, edgeType} = connectionDefinitions({
  nodeType: OrganizationUser
})

export const OrganizationUserConnection = connectionType
export const OrganizationUserEdge = edgeType
export default OrganizationUser
