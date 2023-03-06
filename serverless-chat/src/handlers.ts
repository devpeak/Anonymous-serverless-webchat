import { APIGatewayProxyEvent, APIGatewayProxyEventQueryStringParameters, APIGatewayProxyResult } from "aws-lambda";
import AWS, { AWSError } from "aws-sdk"
import { CLIENT_RENEG_LIMIT } from "tls";

type Action = "$connect" | "$disconnect" | "getMessages" | "sendMessages" | "getClients";

type Client = {
  connectionId: string
  nickname: string
}

const CLIENT_TABLE_NAME = "Clients";

const responseOk={statusCode: 200,
  body: "",
};

const docClient = new AWS.DynamoDB.DocumentClient();

const apiGw = new AWS.ApiGatewayManagementApi({
  endpoint: process.env['WSSAPIGATEWAYENDPOINT']          //see serveless.yaml
});
export const handle = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // wss://asds/aws.com?nickname=abc
  const connectionId = event.requestContext.connectionId as string;
  const routeKey = event.requestContext.routeKey as Action;
  
  switch (routeKey) {
    case "$connect":
      return handleConnect(connectionId, event.queryStringParameters);
 
    case "$disconnect":
      return handleDisconnect(connectionId);
    
    case "getClients":
      return handleGetClients(connectionId);
    
    default:
      return {
        statusCode: 500,
        body: "",
      };
    }
};

const handleConnect = async(
  connectionId:string,
  queryParams: APIGatewayProxyEventQueryStringParameters | null,
  ): Promise<APIGatewayProxyResult> => {
    if (!queryParams || !queryParams["nickname"]){
      return {
        statusCode: 403,
        body: "",
      };
    }

    await docClient.put({
      TableName: CLIENT_TABLE_NAME,
      Item: {
        connectionId, 
        nickname: queryParams["nickname"],
      },
     })
     .promise();
    
    await notifyClients(connectionId);

    return responseOk;
  };

    const handleDisconnect = async(connectionId: string): Promise<APIGatewayProxyResult> => {
      await docClient
        .delete({
          TableName: CLIENT_TABLE_NAME,
          Key:{
            connectionId,
          },
        })
        .promise();
        
        await notifyClients(connectionId);
        return responseOk;
      };


    const notifyClients = async (connectionIdToExclude:string) => {
      const clients = await getAllClients();

      await Promise.all(
      clients.filter((client)=>client.connectionId !== connectionIdToExclude).map(async(client) => {
      await postToConnection(client.connectionId, JSON.stringify(clients));
      }),
      );
    };
    const getAllClients = async(): Promise<Client[]>=>{
        const output = await docClient.scan({
          TableName: CLIENT_TABLE_NAME,
        })
        .promise();

       const clients = output.Items || [];
       return clients as Client[];
      };

    const postToConnection = async (connectionId: string, data: string) => {
      try{
        await apiGw.postToConnection({
          ConnectionId: connectionId,
          Data: data,
        })
        .promise();
      } catch (e) {
  
        if ((e as AWSError).statusCode !== 410){
          throw e;
        }
          await docClient.delete({
            TableName: CLIENT_TABLE_NAME,
            Key: {
              connectionId,
            },
          })
          .promise();  
        } 
      };
    const handleGetClients = async(connectionId: string): Promise<APIGatewayProxyResult> => {
      const clients = await getAllClients();

      await postToConnection(connectionId, JSON.stringify(clients));
    
      return responseOk;
  };