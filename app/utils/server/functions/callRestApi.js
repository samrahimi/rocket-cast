import fetch from 'fetch';

export const callRestApi = (url, callback) => {
    var authHeaders =  
        {'X-Auth-Token': 'VnEl0D4qFue-gobokfNvImOZd16DeYKIEvNxv6Ms69h', 'X-User-ID': 'F6tvjFaf8P2qkMAwJ'}
    

    fetch.fetchUrl(url, {headers: authHeaders}, (error, meta, body) => {
        callback(body)
    })
}