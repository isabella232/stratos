import { promise } from 'protractor';

import { IOrganization, IRoute, ISpace, IApp } from '../../frontend/app/core/cf-api.types';
import { APIResource, CFResponse } from '../../frontend/app/store/types/api.types';
import { CfUser } from '../../frontend/app/store/types/user.types';
import { e2e, E2ESetup } from '../e2e';
import { E2EConfigCloudFoundry } from '../e2e.types';
import { CFRequestHelpers } from './cf-request-helpers';


export class CFHelpers {
  cfRequestHelper: CFRequestHelpers;
  static cachedDefaultCfGuid: string;
  static cachedDefaultOrgGuid: string;
  static cachedDefaultSpaceGuid: string;

  constructor(public e2eSetup: E2ESetup) {
    this.cfRequestHelper = new CFRequestHelpers(e2eSetup);
  }

  private assignAdminAndUserGuids(cnsiGuid: string, endpoint: E2EConfigCloudFoundry): promise.Promise<any> {
    if (endpoint.creds.admin.guid && endpoint.creds.nonAdmin.guid) {
      return promise.fullyResolved({});
    }
    return this.fetchUsers(cnsiGuid).then(users => {
      const testUser = this.findUser(users, endpoint.creds.nonAdmin.username);
      const testAdminUser = this.findUser(users, endpoint.creds.admin.username);
      expect(testUser).toBeDefined();
      expect(testAdminUser).toBeDefined();
      endpoint.creds.nonAdmin.guid = testUser.metadata.guid;
      endpoint.creds.admin.guid = testAdminUser.metadata.guid;
    });
  }

  addOrgIfMissingForEndpointUsers(
    guid: string,
    endpoint: E2EConfigCloudFoundry,
    testOrgName: string,
    skipExistsCheck = false
  ): promise.Promise<APIResource<IOrganization>> {
    return this.assignAdminAndUserGuids(guid, endpoint).then(() => {
      expect(endpoint.creds.nonAdmin.guid).not.toBeNull();
      expect(endpoint.creds.admin.guid).not.toBeNull();
      return skipExistsCheck ?
        this.baseAddOrg(guid, testOrgName) :
        this.addOrgIfMissing(guid, testOrgName, endpoint.creds.admin.guid, endpoint.creds.nonAdmin.guid);
    });
  }

  private findUser(users: any, name: string): APIResource<CfUser> {
    return users.find(user => user && user.entity && user.entity.username === name);
  }

  addOrgIfMissing(cnsiGuid, orgName, adminGuid, userGuid): promise.Promise<APIResource<IOrganization>> {
    let added;

    return this.fetchOrg(cnsiGuid, orgName).then(org => {
      if (!org) {
        added = true;
        return this.baseAddOrg(cnsiGuid, orgName);
      }
      return org;
    }).then(newOrg => {
      if (!added || !adminGuid || !userGuid) {
        // No need to mess around with permissions, it exists already.
        return newOrg;
      }
      const orgGuid = newOrg.metadata.guid;
      const p1 = this.cfRequestHelper.sendCfPut(cnsiGuid, 'organizations/' + orgGuid + '/users/' + adminGuid);
      const p2 = this.cfRequestHelper.sendCfPut(cnsiGuid, 'organizations/' + orgGuid + '/users/' + userGuid);
      // Add user to org users
      return p1.then(() => p2.then(() => {
        return this.cfRequestHelper.sendCfPut(cnsiGuid, 'organizations/' + orgGuid + '/managers/' + adminGuid)
          .then(() => newOrg);
      }));
    });
  }

  addSpaceIfMissingForEndpointUsers(
    cnsiGuid,
    orgGuid,
    orgName,
    spaceName,
    endpoint: E2EConfigCloudFoundry,
    skipExistsCheck = false,
  ): promise.Promise<APIResource<ISpace>> {
    return this.assignAdminAndUserGuids(cnsiGuid, endpoint).then(() => {
      expect(endpoint.creds.nonAdmin.guid).not.toBeNull();
      return skipExistsCheck ?
        this.baseAddSpace(cnsiGuid, orgGuid, orgName, spaceName, endpoint.creds.nonAdmin.guid) :
        this.addSpaceIfMissing(cnsiGuid, orgGuid, orgName, spaceName, endpoint.creds.nonAdmin.guid);

    });
  }

  addSpaceIfMissing(cnsiGuid, orgGuid, orgName, spaceName, userGuid): promise.Promise<APIResource<ISpace>> {
    const that = this;
    return this.fetchSpace(cnsiGuid, orgGuid, spaceName)
      .then(function (space) {
        return space ? space : that.baseAddSpace(cnsiGuid, orgGuid, orgName, spaceName, userGuid);
      });
  }

  fetchServiceExist(cnsiGuid, serviceName) {
    return this.cfRequestHelper.sendCfGet(cnsiGuid, 'service_instances?q=name IN ' + serviceName).then(json => {
      return json.resources;
    });
  }

  deleteOrgIfExisting(cnsiGuid: string, orgName: string) {
    return this.fetchOrg(cnsiGuid, orgName).then(org => {
      if (org) {
        return this.cfRequestHelper.sendCfDelete(cnsiGuid, 'organizations/' + org.metadata.guid + '?recursive=true&async=false');
      }
    });
  }

  deleteSpaceIfExisting(cnsiGuid: string, orgGuid: string, spaceName: string) {
    return this.fetchSpace(cnsiGuid, orgGuid, spaceName).then(space => {
      if (space) {
        return this.cfRequestHelper.sendCfDelete(cnsiGuid, 'spaces/' + space.metadata.guid);
      }
    });
  }

  fetchUsers(cnsiGuid) {
    return this.cfRequestHelper.sendCfGet(cnsiGuid, 'users').then(json => {
      return json.resources;
    });
  }

  fetchOrg(cnsiGuid: string, orgName: string): promise.Promise<APIResource<any>> {
    return this.cfRequestHelper.sendCfGet(cnsiGuid, 'organizations?q=name IN ' + orgName).then(json => {
      if (json.total_results > 0) {
        const org = json.resources[0];
        return org;
      }
      return null;
    });
  }

  fetchSpace(cnsiGuid: string, orgGuid: string, spaceName: string) {
    return this.cfRequestHelper.sendCfGet(cnsiGuid, 'spaces?q=name IN ' + spaceName + '&organization_guid=' + orgGuid).then(json => {
      if (json.total_results > 0) {
        const space = json.resources[0];
        return space;
      }
      return null;
    });
  }

  fetchAppsCountInSpace(cnsiGuid: string, spaceGuid: string) {
    return this.cfRequestHelper.sendCfGet(cnsiGuid, `spaces/${spaceGuid}/apps`).then(json => {
      return json.total_results;
    });
  }

  fetchRoutesInSpace(cnsiGuid: string, spaceGuid: string): promise.Promise<APIResource<IRoute>[]> {
    return this.cfRequestHelper.sendCfGet<CFResponse<IRoute>>(cnsiGuid, `/spaces/${spaceGuid}/routes?results-per-page=100`)
      .then(json => {
        if (json.total_results > 100) {
          fail('Number of routes in space is over the max page size of 100, requires de-paginating');
        }
        return json.resources;
      });
  }

  // For fully fleshed out fetch see application-e2e-helpers
  basicFetchApp(cnsiGuid: string, spaceGuid: string, appName: string) {
    return this.cfRequestHelper.sendCfGet(cnsiGuid,
      `apps?inline-relations-depth=1&include-relations=routes,service_bindings&q=name IN ${appName},space_guid IN ${spaceGuid}`);
  }

  // For fully fleshed our create see application-e2e-helpers
  basicCreateApp(cnsiGuid: string, spaceGuid: string, appName: string): promise.Promise<APIResource<IApp>> {
    return this.cfRequestHelper.sendCfPost(cnsiGuid, 'apps', { name: appName, space_guid: spaceGuid });
  }

  // For fully fleshed out delete see application-e2e-helpers (includes route and service instance deletion)
  basicDeleteApp(cnsiGuid: string, appGuid: string) {
    return this.cfRequestHelper.sendCfDelete(cnsiGuid, 'apps/' + appGuid);
  }

  baseAddSpace(cnsiGuid, orgGuid, orgName, spaceName, userGuid): promise.Promise<APIResource<ISpace>> {
    const cfRequestHelper = this.cfRequestHelper;
    return cfRequestHelper.sendCfPost<APIResource<ISpace>>(cnsiGuid, 'spaces',
      {
        name: spaceName,
        manager_guids: [],
        developer_guids: [userGuid],
        organization_guid: orgGuid
      });
  }

  baseAddOrg(cnsiGuid: string, orgName: string): promise.Promise<APIResource<IOrganization>> {
    return this.cfRequestHelper.sendCfPost<APIResource<IOrganization>>(cnsiGuid, 'organizations', { name: orgName });
  }

  fetchAppRoutes(cnsiGuid: string, appGuid: string): promise.Promise<APIResource<IRoute>[]> {
    return this.cfRequestHelper.sendCfGet(cnsiGuid, `apps/${appGuid}/routes`).then(res => res.resources);
  }

  updateDefaultCfOrgSpace = (): promise.Promise<any> => {
    // Fetch cf guid, org guid, or space guid from ... cache or jetstream
    return this.fetchDefaultCfGuid(false)
      .then(() => this.fetchDefaultOrgGuid(false))
      .then(() => this.fetchDefaultSpaceGuid(false));
  }


  fetchDefaultCfGuid = (fromCache = true): promise.Promise<string> => {
    return fromCache && CFHelpers.cachedDefaultCfGuid ?
      promise.fullyResolved(CFHelpers.cachedDefaultCfGuid) :
      this.cfRequestHelper.getCfGuid().then(guid => {
        CFHelpers.cachedDefaultCfGuid = guid;
        return CFHelpers.cachedDefaultCfGuid;
      });
  }

  fetchDefaultOrgGuid = (fromCache = true): promise.Promise<string> => {
    return fromCache && CFHelpers.cachedDefaultOrgGuid ?
      promise.fullyResolved(CFHelpers.cachedDefaultOrgGuid) :
      this.fetchDefaultCfGuid(true)
        .then(guid => this.addOrgIfMissingForEndpointUsers(
          guid,
          e2e.secrets.getDefaultCFEndpoint(),
          e2e.secrets.getDefaultCFEndpoint().testOrg
        ))
        .then(org => {
          CFHelpers.cachedDefaultOrgGuid = org.metadata.guid;
          return CFHelpers.cachedDefaultOrgGuid;
        });
  }

  fetchDefaultSpaceGuid = (fromCache = true): promise.Promise<string> => {
    return fromCache && CFHelpers.cachedDefaultSpaceGuid ?
      promise.fullyResolved(CFHelpers.cachedDefaultSpaceGuid) :
      this.fetchDefaultOrgGuid(true)
        .then(orgGuid =>
          this.addSpaceIfMissingForEndpointUsers(
            CFHelpers.cachedDefaultCfGuid,
            CFHelpers.cachedDefaultOrgGuid,
            e2e.secrets.getDefaultCFEndpoint().testOrg,
            e2e.secrets.getDefaultCFEndpoint().testSpace,
            e2e.secrets.getDefaultCFEndpoint()
          )
        )
        .then(space => {
          CFHelpers.cachedDefaultSpaceGuid = space.metadata.guid;
          return CFHelpers.cachedDefaultSpaceGuid;
        });
  }

  addOrgUserRole(cfGuid, orgGuid, userName) {
    return this.cfRequestHelper.sendCfPut<APIResource<CfUser>>(cfGuid, 'organizations/' + orgGuid + '/users', {
      username: userName
    });
  }

  addOrgUserManager(cfGuid, orgGuid, userName) {
    return this.cfRequestHelper.sendCfPut<APIResource<CfUser>>(cfGuid, 'organizations/' + orgGuid + '/managers', {
      username: userName
    });
  }

  addOrgUserAuditor(cfGuid, orgGuid, userName) {
    return this.cfRequestHelper.sendCfPut<APIResource<CfUser>>(cfGuid, 'organizations/' + orgGuid + '/auditors', {
      username: userName
    });
  }

  addOrgUserBillingManager(cfGuid, orgGuid, userName) {
    return this.cfRequestHelper.sendCfPut<APIResource<CfUser>>(cfGuid, 'organizations/' + orgGuid + '/billing_managers', {
      username: userName
    });
  }

  addSpaceDeveloper(cfGuid, spaceGuid, userName) {
    return this.cfRequestHelper.sendCfPut<APIResource<CfUser>>(cfGuid, 'spaces/' + spaceGuid + '/developers', {
      username: userName
    });
  }

  addSpaceAuditor(cfGuid, spaceGuid, userName) {
    return this.cfRequestHelper.sendCfPut<APIResource<CfUser>>(cfGuid, 'spaces/' + spaceGuid + '/auditors', {
      username: userName
    });
  }

  addSpaceManager(cfGuid, spaceGuid, userName) {
    return this.cfRequestHelper.sendCfPut<APIResource<CfUser>>(cfGuid, 'spaces/' + spaceGuid + '/managers', {
      username: userName
    });
  }

}
