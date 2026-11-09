export const holdErrors:Record<string,string>={
 INVALID_INPUT:'Use two different accounts, CAD, an issued request key and 1 to 10000 minor units. No request was sent.',
 KEY_CONFLICT:'This key already belongs to a different request.',
 HOLD_UNCONFIRMED:'The hold could not be confirmed. This tool call sent nothing to Teller. An earlier approved attempt may have run. Check the queue and retry with the same request key.',
 HELD_UNAVAILABLE:'The request is still held. Teller was not called. Open this page again to approve when the connection is available.',
 OUTCOME_UNKNOWN:"Teller's result is not confirmed. Do not create another request; check this queue entry.",
 UPSTREAM_REJECTED:'Teller rejected this request. Check the queue; it will not retry automatically.',
 UPSTREAM_AUTH:'Teller did not authorize this request. It will not retry automatically.',
 UPSTREAM_CONFLICT:'Teller could not accept this request. Review its recorded result before retrying.',
 STALE_ACTION:'This action has expired or was already used. Open the request again to see its current state.',
 PAYLOAD_MISMATCH:'The saved request could not be verified. No new request was sent.',
 DEMO_UNAVAILABLE:'The demo is unavailable. Try again later.',
};
