var fb = angular.module('lformsApp');
fb.service('fhirService', [
  '$rootScope',
  '$q',
  '$http',
  '$window',
  function($rootScope, $q, $http, $window) {
    var thisService = this;

    // Currently selected patient
    thisService.currentPatient = null;

    // smart on fhir connection
    thisService.connection = null;
    // the fhir api handler
    thisService.fhir = null;

    // Current Questionnaire resource
    thisService.currentQuestionnaire = null;

    // Holds results of a chain of operations
    var _collectedResults = [];
    // Holds the error result that halted a chain of operations
    var _terminatingError = null;

    /**
     *  Requests a SMART on FHIR connection.  Once a connection request is in
     *  progress, further requests are ignored until a connection is
     *  established.  (So, only one request can be in progress at a time.)
     * @param callback a callback for when the connection is obtained.  If a
     *  connection request was already in progress, the callback will not be
     *  called.  If called, it will be passed a boolean indicating the success
     *  of the connection attempt.
     */
    thisService.requestSmartConnection = function(callback) {
      thisService.connection = null;
      if (!thisService._connectionInProgress) {
        thisService._connectionInProgress = true;
        FHIR.oauth2.ready(function(smart) {
          thisService.setSmartConnection(smart);
          thisService._connectionInProgress = false;
          callback(true);
        }, function() {callback(false)});
      }
    };

    /**
     *  Returns true if the smart connection has been requested and is in
     *  progress.
     */
    thisService.smartConnectionInProgress = function() {
      return thisService._connectionInProgress;
    };


    /**
     * Set the smart on fhir connection
     * @param connection a connection to smart on fhir service
     */
    thisService.setSmartConnection = function(connection) {
      thisService.connection = connection;
      thisService.fhir = connection.patient.api;
      //thisService.fhir = connection.api;
      LForms.Util.setFHIRContext({
        getCurrent:  function(typeList, callback) {
          var rtn = null;
          if (typeList.indexOf('Patient') >= 0) {
            connection.patient.read().then(function(patientRes) {
              callback(patientRes);
            });
          }
        },
        getFHIRAPI: function() {
          return thisService.fhir;
        }
      });

      // Retrieve the fhir version
      // For some reason setSmartConnection gets called multiple times on page load.
      LForms.Util.getServerFHIRReleaseID(function(releaseID) {
        thisService.fhirVersion = releaseID;
      });
    };


    /**
     *  Sets up a client for a standard (open) FHIR server.
     * @param baseURL the base URL of the FHIR server.
     * @param commCallback A callback function that will be passed a boolean as to
     *  whether communication with the server was successfully established.
     */
    thisService.setNonSmartServer = function(baseURL, commCallback) {
      try {
        thisService.connection = {server: {serviceUrl: baseURL}};
        thisService.fhir = FHIR.client({serviceUrl: baseURL}).api;
        thisService.nonSmartContext = {
          baseURL: baseURL,
          getCurrent: function(typeList, callback) {
            var rtn = null;
            if (typeList.indexOf('Patient') >= 0) {
              setTimeout(function() {callback(thisService.currentPatient)});
            }
          },
          getFHIRAPI: function() {
            return thisService.fhir;
          }
        }
        LForms.Util.setFHIRContext(thisService.nonSmartContext);
        // Retrieve the fhir version
        LForms.Util.getServerFHIRReleaseID(function(releaseID) {
          if (releaseID !== undefined) {
            thisService.fhirVersion = releaseID;
            commCallback(true);
          }
          else
            commCallback(false); // error signal
        });
      }
      catch (e) {
        commCallback(false);
        throw e;
      }
    };



    /**
     * Get the smart on fhir connection (or, the non-smart connection if that is
     * what was used.)
     * @returns the smart on fhir connection or null
     */
    thisService.getSmartConnection = function() {
      return thisService.connection;
    };


    /**
     *  Returns the base URL of the FHIR server the app is using.
     */
    thisService.getServerBaseURL = function() {
      return thisService.getSmartConnection().server.serviceUrl;
    };


    /**
     * Set the current Questionnaire resource
     * Data returned through an angular broadcast event.
     * @param q the selected Questionnaire resource
     */
    thisService.setCurrentQuestionnaire = function(q) {
      // reset current Questionnaire resource
      thisService.currentQuestionnaire = q;
      $rootScope.$broadcast('LF_FHIR_QUESTIONNAIRE_SELECTED', {resource: q});
    };


    /**
     * Get the current selected Questionnaire resource
     * @returns {null}
     */
    thisService.getCurrentQuestionnaire = function() {
      return thisService.currentQuestionnaire;
    };


    /**
     * Set the current selected patient
     * Data returned through an angular broadcast event.
     * @param patient the selected patient
     */
    thisService.setCurrentPatient = function(patient) {
      thisService.currentPatient = patient;
      if (thisService.nonSmartContext) {
        // Update the FHIR connection to constrain resources to the patient.
        // Following
        // https://github.com/smart-on-fhir/client-js/blob/master/src/client/client.js
        // for lack of documentation about "patient" in fhir.js.
        thisService.fhir = FHIR.client({serviceUrl: thisService.nonSmartContext.baseURL,
          patientId: patient.id}).patient.api
      }
    };


    /**
     * Get the current selected patient
     * @returns {null}
     */
    thisService.getCurrentPatient = function() {
      return thisService.currentPatient;
    };

    /**
     * Get the patient's display name
     * @param patient optional, an FHIR Patient resource
     * @returns {string} a formatted patient name
     * @private
     */
    thisService.getPatientName = function(patient) {
      var currentPatient = patient ? patient : thisService.currentPatient;
      var name = "";
      if (currentPatient && currentPatient.name && currentPatient.name.length > 0) {
        if (currentPatient.name[0].given && currentPatient.name[0].family) {
          name = currentPatient.name[0].given[0] + " " + currentPatient.name[0].family;
        }
        else if (currentPatient.name[0].family) {
          name = currentPatient.name[0].family;
        }
        else if (currentPatient.name[0].given ) {
          name = currentPatient.name[0].given[0]
        }
      }
      return name;
    };


    /**
     * Get the patient's phone number
     * @param patient optional, an FHIR Patient resource
     * @returns {string} the first available phone number
     * @private
     */
    thisService.getPatientPhoneNumber = function(patient) {
      var currentPatient = patient ? patient : thisService.currentPatient;
      var phone = "";
      if (currentPatient && currentPatient.telecom) {
        for (var i=0, iLen=currentPatient.telecom.length; i<iLen; i++) {
          if (currentPatient.telecom[i].system==="phone" && currentPatient.telecom[i].value) {
            phone = currentPatient.telecom[i].use ? currentPatient.telecom[i].use + ": " + currentPatient.telecom[i].value :
              currentPatient.telecom[i].value;
            break;
          }
        }
      }
      return phone;
    };


    /**
     * Get FHIR pagination results using a link url in the current bundle
     *
     * @param resType - The FHIR bundle from which to extract the relation url.
     * @param relation - A string specifying the relation ('prev' | 'next')
     * @returns {Object} - FHIR resource bundle
     */
    thisService.getPage = function(resType, relation, url) {
      var baseUrl = $window.location.origin + '/fhir-api?';
      var url = url.replace(/^.*\/baseDstu3\?/, baseUrl);

      // if (resType === "QuestionnaireResponse") {
      //   url += "?_sort=-authored";
      // }
      // else if  (resType === "Questionnaire") {
      //   url += "?_sort=-date";
      // }

      var fn;
      if(relation === 'next') {
        fn = thisService.fhir.nextPage;
      }
      else if (relation === 'previous') {
        relation = 'prev'; // fhir-client.js does not handle "previous"
        fn = thisService.fhir.prevPage;
      }

      var bundle = {
        "resourceType": "Bundle",
        "type": "searchset",
        "link": [
          {
            "relation": relation,
            "url": url
          }
        ]
      };

      fn({bundle: bundle})
        .then(function(response) {   // response.data is a searchset bundle
          if (resType === "Questionnaire") {
            $rootScope.$broadcast('LF_FHIR_QUESTIONNAIRE_LIST', response.data);
          }
          else if (resType === "QuestionnaireResponse") {
            $rootScope.$broadcast('LF_FHIR_QUESTIONNAIRERESPONSE_LIST', response.data);
          }
          // else if (resType === "DiagnosticReport") {
          //   $rootScope.$broadcast('LF_FHIR_DIAGNOSTICREPORT_LIST', response.data);
          // }
        }, function(error) {
          console.log(error);
        });

    };


    /**
     * Search patients by name
     * Data returned through an angular broadcast event.
     * @param searchText the search text for patient names
     * @returns {*}
     */
    thisService.searchPatientByName = function(searchText) {
      // md-autocomplete directive requires a promise to be returned
      return thisService.fhir.search({
        type: "Patient",
        query: {name: searchText},
        headers: {'Cache-Control': 'no-cache'}
      })
        .then(function(response) {
          // process data for md-autocomplete
          var patientList = [];
          if (response && response.data.entry) {
            for (var i=0, iLen=response.data.entry.length; i<iLen; i++) {
              var patient = response.data.entry[i].resource;
              patientList.push({
                name: thisService.getPatientName(patient),
                gender: patient.gender,
                dob: patient.birthDate,
                phone: thisService.getPatientPhoneNumber(patient),
                id: patient.id,
                resource: patient
              })
            }
          }

          // // it is actually not needed, since the returned list is handled directly in md-autocomplete
          // // use broadcasted event if the returned data needed to be handled in other controllers.
          // $rootScope.$broadcast('LF_FHIR_PATIENT_LIST', patientList);

          return patientList;
        }, function(error) {
          console.log(error);
        });
    };


    /**
     * Search questionnaires by name
     * Data returned through an angular broadcast event.
     * @param searchText the search text for patient names
     * @returns {*}
     */
    thisService.searchQuestionnaireByName = function(searchText) {
      // md-autocomplete directive requires a promise to be returned
      return thisService.fhir.search({
        type: "Questionnaire",
        query: {name: searchText},
        headers: {'Cache-Control': 'no-cache'}
      })
        .then(function(response) {
          // process data for md-autocomplete
          var qList = [];
          if (response && response.data.entry) {
            for (var i=0, iLen=response.data.entry.length; i<iLen; i++) {
              var q = response.data.entry[i].resource;
              qList.push({
                name: q.name,
                status: q.status,
                id: q.id,
                resource: q
              })
            }
          }

          return qList;
        }, function(error) {
          console.log(error);
        });
    };

    /**
     * Get a FHIR resource by resource ID
     * Data returned through an angular broadcast event.
     * @param resType FHIR resource type
     * @param resId FHIR resource ID
     */
    thisService.getFhirResourceById = function(resType, resId) {
      thisService.fhir.read({type: resType, id: resId})
        .then(function(response) {
          $rootScope.$broadcast('LF_FHIR_RESOURCE',
            {resType: resType, resource: response.data, resId: resId});
        }, function(error) {
          console.log(error);
        });
    };


    /**
     * Get the QuestionnaireResponse resource by id and its related Questionnaire resource
     * Data returned through an angular broadcast event.
     * @param resType FHIR resource type
     * @param resId FHIR resource ID
     */
    thisService.getMergedQQR = function(resType, resId) {
      thisService.fhir.search(
        {
          type: resType,
          query: {_id: resId, _include: 'QuestionnaireResponse:questionnaire'},
          headers: {'Cache-Control': 'no-cache'}
      })
        .then(function(response) {
          var result = {qResource: null, qrResource: null};

          // not found, might be deleted from FHIR server by other apps
          var resNum = response.data.entry.length;
          if (resNum === 0) {
          }
          // one or two resource found
          else if (resNum === 1 || resNum === 2) {
            for (var i=0; i<resNum; i++) {
              var res = response.data.entry[i].resource;
              if (res.resourceType === 'QuestionnaireResponse') {
                result.qrResource = res;
              }
              else if (res.resourceType === 'Questionnaire') {
                result.qResource = res;
              }
            }
          }
          $rootScope.$broadcast('LF_FHIR_MERGED_QQR', result);
        }, function(error) {
          console.log(error);
        });
    };


    /**
     *   Sets the reference to a questionnaire in a QuesitonnaireResponse.
     *  @param qrData the QuestionnaireResponse needing the Questionnaire
     *  reference.
     *  @param qData the Questionnaire (or at least the ID field).
     */
    thisService.setQRRefToQ = function(qrData, qData) {
      var qID = qData.id;
      if (thisService.fhirVersion === 'STU3')
        qrData.questionnaire = {"reference": "Questionnaire/" + qID};
      else
        qrData.questionnaire = "Questionnaire/" + qID

    }


    /**
     *  Creates a QuestionnairResponse.
     * @param qrData the QuestionnaireResponse to be created.
     * @param qData the Questionnaire resource, or at least the ID and name
     *  fields.
     */
    thisService.createQR = function (qrData, qData) {
      // Set the questionnaire reference in the response
      thisService.setQRRefToQ(qrData, qData);

      // create QuestionnaireResponse
      thisService.fhir.create({resource: qrData}).then(
        function success(resp) {
          $rootScope.$broadcast('LF_FHIR_QR_CREATED',
            { resType: "QuestionnaireResponse",
              resource: resp.data,
              resId: resp.data.id,
              qResId: qData.id,
              qName: qData.name,
              extensionType: 'SDC'
            });
          _collectedResults.push(resp);
          reportResults();
        },
        function error(error) {
          console.log(error);
          _terminatingError = error;
          reportResults();
        }
      );
    }


    /**
     *  Broadcasts information about a failed operation.  The application should listen for 'OP_FAILED' broadcasts.
     * @param resourceType the type of the resource involved
     * @param opName the name of the operation (e.g. "create")
     * @param errInfo the error structure returned by the FHIR client.
     */
    function reportError(resourceType, opName, errInfo) {
      $rootScope.$broadcast('OP_FAILED',
        { resType: resourceType,
          operation: opName,
          errInfo: errInfo
        });
    }


    /**
     * Create Questionnaire if it does not exist, and QuestionnaireResponse and
     * its extracted observations.
     * Data returned through an angular broadcast event.
     * @param q the Questionnaire resource
     * @param qr the QuestionnaireResponse resource
     * @param obsArray the array of Observations extracted from qr
     * @param qExists true if the questionnaire is known to exist (in which case
     * we skip the lookup)
     */
    thisService.createQQRObs = function(q, qr, obsArray, qExists) {
      _terminatingError = null;

      // Build a FHIR transaction bundle to create these resources.
      var bundle = {
        resourceType:"Bundle",
        type: "transaction",
        entry: []
      };

      bundle.entry.push({
        resource: qr,
        request: {
          method: "POST",
          url: "QuestionnaireResponse"
        }
      });

      for (var i=0, len=obsArray.length; i<len; ++i) {
        bundle.entry.push({
          resource: obsArray[i],
          request: {
            method: "POST",
            url: "Observation"
          }
        });
      }

      function withQuestionnaire(q) {
        // Set the questionnaire reference in the response
        var qr = bundle.entry[0].resource;
        var qRef = 'Questionnaire/'+q.id;
        if (thisService.fhirVersion == 'STU3')
          qr.questionnaire = {reference: qRef};
        else
          qr.questionnaire = qRef;

        thisService.fhir.transaction({bundle: bundle}).then(
          function success(resp) {
            _collectedResults.push(resp);
            reportResults();
            // Look through the bundle for the QuestionnaireResource ID
            var entries = resp.data.entry;
            var qrID = null;
            for (var i=0, len=entries.length; i<len && !qrID; ++i) {
              var entry = entries[i];
              var matchData = entry.response && entry.response.location
                && entry.response.location.match(/^QuestionnaireResponse\/(\d+)/);
              if (matchData)
                qrID = matchData[1];
            }
            $rootScope.$broadcast('LF_FHIR_QR_CREATED', {
              resType: "QuestionnaireResponse",
              resource: qr,
              resId: qrID,
              qResId: q.id,
              qName: q.name,
              extensionType: 'SDC'
            });
          },
          function error(err) {
            _terminatingError = {resType: 'Bundle', operation: 'create', errInfo: err};
            reportResults();
          }
        );
      }
      if (qExists)
        withQuestionnaire(q);
      else
        createOrFindAndCall(q, withQuestionnaire);
    };


    /**
     *  Reports the results of one or more operations (which might have
     *  terminated in an error.
     */
    function reportResults() {
      $rootScope.$broadcast('OP_RESULTS',
        {
          successfulResults: JSON.parse(JSON.stringify(_collectedResults)),
          error: JSON.parse(JSON.stringify(_terminatingError))
        }
      );
      _collectedResults = [];
      _terminatingError = null;
    }


    /**
     *  Checks the server to see if questionnaire q is already there, creates it
     *  if needed, and then calls function withQuestionnaire.
     * @param q A questionnaire that needs to exist prior to withQuestionnaire
     *  being created.
     * @param withQuestionnaire a function to be called with the questionnaire
     *  resource from the server.
     */
    function createOrFindAndCall(q, withQuestionnaire) {
      function createQAndCall() {
        thisService.fhir.create({resource: q}).then(function success(resp) {
          $rootScope.$broadcast('LF_FHIR_Q_CREATED',
            { resType: "Questionnaire",
              resource: resp.data,
              resId: resp.data.id,
              extensionType: 'SDC'
            });
          thisService.currentQuestionnaire = resp.data;
          withQuestionnaire(resp.data);
        },
        function error(error) {
          _terminatingError = {resType: 'Questionnaire', operation: 'create', errInfo: error};
          reportResults();
        });
      }

      // check if a related Questionnaire exists
      var queryJson;
      // It was decided that in the current UI, which only allows introduction
      // of forms via an "upload", that it would be better to always create a
      // new Questionnaire, to allow for repeated cycles of editing.  So, for
      // now, I am disbling the search for an existing questionnaire here.
      if (false) { // disabling (for now) the search for existing Qustionnaire
        if (q.url)
          queryJson = {url: q.url}
        else if (q.identifier && q.identifier[0])
          queryJson = {identifier: q.identifier[0].system+'|' + q.identifier[0].value}
        else if (q.code && q.code[0])
          queryJson = {code: q.code[0].system+'|' + q.code[0].value};
        else if (q.name)
          queryJson = {name: q.name}
        else if (q.title)
          queryJson = {title: q.title}
      }
      if (!queryJson) {
        // Can't form a query, so just make a new one
        createQAndCall();
      }
      else {
        thisService.fhir.search({
          type: "Questionnaire",
          query: queryJson,
          headers: {'Cache-Control': 'no-cache'}
        }).then(function success(resp) {
          var bundle = resp.data;
          var count = (bundle.entry && bundle.entry.length) || 0;
          // found existing Questionnaires
          if (count > 0 ) {
            var oneQuestionnaireResource = bundle.entry[0].resource;
            withQuestionnaire(oneQuestionnaireResource);
          }
          // no Questionnaire found, create a new Questionnaire first
          else {
            createQAndCall();
          }
        },
        function error(error) {
          _terminatingError = {resType: 'Questionnaire', operation: 'search', errInfo: error};
          reportResults();
        });
      }
    };


    /**
     * Create Questionnaire if it does not exist, and QuestionnaireResponse
     * Data returned through an angular broadcast event.
     * @param q the Questionnaire resource
     * @param qr the QuestionnaireResponse resource
     * @param extenstionType optional, for Questionnaire/QuestionnaireResponse it could be "SDC"
     */
    thisService.createQQR = function(q, qr, extensionType) {
      function withQuestionnaire(q) {
        thisService.createQR(qr, q);
      }

      createOrFindAndCall(q, withQuestionnaire);
    };


    /**
     * Update an FHIR resource
     * Data returned through an angular broadcast event.
     * @param resType FHIR resource type
     * @param resource the FHIR resource
     */
    thisService.updateFhirResource = function(resType, resource) {
      thisService.fhir.update({resource: resource})
        .then(function success(response) {
          $rootScope.$broadcast('LF_FHIR_RESOURCE_UPDATED',
            {resType: resType, resource: response.data, resId: resource.id});
        },
        function error(response) {
          console.log(response);
          reportError(resType, 'update', response);
        });
    };


    /**
     * Delete a QuestionnaireResponse and its associated Observations (if any).
     * Status returned through an angular broadcast event.
     * @param resId FHIR resource ID
     * @param reportSuccess Whether the report successful results (default
     *  true).
     * @return a promise that resolves when the deletion has finished.
     */
    thisService.deleteQRespAndObs = function(resId, reportSuccess) {
      var rtnPromise;;
      if (thisService.fhirVersion === 'STU3') {
        // STU3 does not have the derivedFrom field in Observation which links
        // them to QuestionnaireResponse.
        rtnPromise = thisService.deleteFhirResource('QuestionnaireResponse',
          resId, reportSuccess);
      }
      else {
        rtnPromise = thisService.fhir.search({
          type: 'Observation',
          query: {
            'derived-from': 'QuestionnaireResponse/'+resId,
          },
          headers: {
            'Cache-Control': 'no-cache'
          }
        }).then(function(response) {   // response.data is a searchset bundle
          var thenPromise;
          var bundle = response.data;
          var entries = bundle.entry;
          if (entries && entries.length > 0) {
            var errorReported = false;
            var obsDelPromises = [];
            for (var i=0, len=entries.length; i<len; ++i) {
              var obsId = entries[i].resource.id;
              obsDelPromises.push(thisService.fhir.delete({type: 'Observation', id: obsId}));
            }
            thenPromise = Promise.all(obsDelPromises).then(
              function success(response) {
                return thisService.deleteFhirResource('QuestionnaireResponse', resId, reportSuccess);
              }, function error(response) {
                if (!errorReported) { // just report the first
                  errorReported = true;
                  console.log(response);
                  reportError('QuestionnaireResponse', 'delete', response);
                }
              }
            );
          }
          else { // no observations to delete
            thenPromise = thisService.deleteFhirResource('QuestionnaireResponse',
              resId, reportSuccess);
          }
          return thenPromise;
        }, function(error) {
          console.log(error);
          reportError('QuestionnaireResponse', 'delete', error);
        });
      }
      return rtnPromise;
    };


    /**
     * Delete a Questionnaire, any saved QuestionnaireResponses for that
     * Questionnaire, and associated Observations (if any).  Status returned
     * through an angular broadcast event.
     * @param resId FHIR resource ID
     * @return a promise that resolves when all of the deletion is finished.
     */
    thisService.deleteQAndQRespAndObs = function(resId) {
      return thisService.fhir.search({
        type: 'QuestionnaireResponse',
        query: {
          'questionnaire': 'Questionnaire/'+resId,
        },
        headers: {
          'Cache-Control': 'no-cache'
        }
      }).then(function(response) {   // response.data is a searchset bundle
        var thenPromise;
        var bundle = response.data;
        var entries = bundle.entry;
        if (entries && entries.length > 0) {
          var pendingDeletions = 0;
          var qRespDelPromises = [];
          for (var i=0, len=entries.length; i<len; ++i) {
            var qResId = entries[i].resource.id;
            qRespDelPromises.push(thisService.deleteQRespAndObs(qResId, false));
          }
          thenPromise = Promise.all(qRespDelPromises).then(
            function success(response) {
              thisService.deleteFhirResource('Questionnaire', resId);
            },
            function error(response) {
              console.log(response);
              reportError('QuestionnaireResponse', 'delete', response);
            }
          );
        }
        else // no QuestionnaireResponses to delete
          thenPromise = thisService.deleteFhirResource('Questionnaire', resId);
        return thenPromise;
      }, function(error) {
        console.log(error);
        reportError('QuestionnaireResponse', 'delete', error);
      });
    };


    /**
     *  Deletes an FHIR resource, and reports the result.
     *  Status returned through an angular broadcast event.
     * @param resType FHIR resource type
     * @param resId FHIR resource ID
     * @param reportSuccess Whether the report successful results (default
     *  true).
     * @return a promise that resolves when the resource is deleted
     */
    thisService.deleteFhirResource = function(resType, resId, reportSuccess) {
      if (reportSuccess === undefined)
        reportSuccess = true;
      return thisService.fhir.delete({type: resType, id: resId})
        .then(function success(response) {
          // response.data === "OK"
          if (reportSuccess) {
            $rootScope.$broadcast('LF_FHIR_RESOURCE_DELETED',
              {resType: resType, resource: null, resId: resId});
          }
        },
        function error(response) {
          console.log(response);
          reportError(resType, 'delete', response);
        });
    };


    /**
     * Get a Bundle with a DiagnosticReport resource and its all results Observation resources
     * @param resType FHIR resource type (should be DiagnosticReport)
     * @param resId FHIR resource ID
     * not used
     */
    thisService.getDRAndObxBundle = function(resType, resId) {
      thisService.fhir.search({
        type: 'DiagnosticReport',
        query: {
          _id: resId,
          _include: 'DiagnosticReport:result'
        },
        headers: {
          'Cache-Control': 'no-cache'
        }
      })
        .then(function(response) {   // response.data is a searchset bundle
          $rootScope.$broadcast('LF_FHIR_DR_OBX_BUNDLE', response.data);
        }, function(error) {
          console.log(error);
        });
    };


    /**
     * Process a FHIR transaction bundle.
     * Within the bundle, each resource could have its own request method.
     * @param bundle a FHIR transaction bundel.
     */
    thisService.handleTransactionBundle = function(bundle) {
      thisService.fhir.transaction({bundle: bundle}).then(
        function success(resp) {
          $rootScope.$broadcast('LF_FHIR_BUNDLE_PROCESSED',
            { resType: "Bundle",
              resource: resp.data,
              resId: resp.data.id,
              qResId: qID,
              qName: qData.name,
              extensionType: extensionType
            });
        },
        function error(error) {
          console.log(error);
          reportError('Bundle', 'create', error);
        }
      )
    };


    /**
     * Get all QuestionnaireResponse resources of a patient
     * Data returned through an angular broadcast event.
     * @param pId the current patient's ID
     */
    thisService.getAllQRByPatientId = function(pId) {
      thisService.fhir.search({
        type: 'QuestionnaireResponse',
        query: {
          subject: 'Patient/' + pId,
          _include: 'QuestionnaireResponse:questionnaire',
          _sort: '-_lastUpdated',
          _count: 5
        },
        headers: {
          'Cache-Control': 'no-cache'
        }
      })
        .then(function(response) {   // response.data is a searchset bundle
          $rootScope.$broadcast('LF_FHIR_QUESTIONNAIRERESPONSE_LIST', response.data);
        }, function(error) {
          $rootScope.$broadcast('LF_FHIR_QUESTIONNAIRERESPONSE_LIST', null, error);
          console.log(error);
        });
    };


    /**
     * Find the referred Questionnaire resource in a search set
     * @param searchSet an FHIR search set
     * @param qId the id of a Questionnaire resource
     * @returns {*}
     */
    thisService.findQuestionnaire = function(searchSet, qId) {
      var qRes = null;
      if (searchSet) {
        for (var i=0, iLen=searchSet.entry.length; i< iLen; i++) {
          var resource = searchSet.entry[i].resource;
          if (resource.resourceType === "Questionnaire" && resource.id === qId) {
            qRes = resource;
            break;
          }
        }
      }
      return qRes;
    };


    /**
     * Get all Questionnaire resources
     * Data returned through an angular broadcast event.
     */
    thisService.getAllQ = function() {

      thisService.fhir.search({
        type: 'Questionnaire',
        query: {
          _sort: '-_lastUpdated',
          _count: 10
        },
        headers: {
          'Cache-Control': 'no-cache'
        }
      })
        .then(function(response) {   // response.data is a searchset bundle
          $rootScope.$broadcast('LF_FHIR_QUESTIONNAIRE_LIST', response.data);
        }, function(error) {
          $rootScope.$broadcast('LF_FHIR_QUESTIONNAIRE_LIST', null, error);
          console.log(error);
        });
    };

  }]);
