let express = require('express'); // Express web server framework
let router = express.Router();
let path = require('path');
const fetch = require("node-fetch");
let bodyParser = require('body-parser');
let config = require('../config');
let btoa = require('btoa');
const querystring = require('querystring');

let access_token = '';
let timeouts = [];

function getID(track) {
    return track['track']['id'];
}

function getID2(track) {
    return track['track'];
}

async function sendRequest(req_cookies, url, data) {
    if (access_token === '') {
        access_token = req_cookies['access_token'];
    }
    data.headers = { 'Authorization': 'Bearer ' + access_token};
    let response = await fetch(url, data);
    if (response.status === 401) {
        await updateAuthToken(req_cookies);
        return await sendRequest(req_cookies, url, data);
    } else if (response.status > 204) {
        console.log(url);
        console.log(data);
        console.log(response);
        //res.render('error', {error: response})
    } else {
        return response;
    }
}

async function updateAuthToken(req_cookies) {
    let url = 'https://accounts.spotify.com/api/token';
    let main_info = {grant_type: 'refresh_token', refresh_token: req_cookies['refresh_token']};
    let headers = {'Authorization': 'Basic ' + btoa(config.client_id + ':' + config.client_secret),
        'Content-Type':'application/x-www-form-urlencoded'};
    let response = await fetch(url, {method: 'POST', headers: headers, body: querystring.stringify(main_info)});
    let json_version = await response.json();
    access_token = json_version.access_token;
}

async function getSongIds(album_id, req_cookies) {
    let url = 'https://api.spotify.com/v1/playlists/' + album_id;
    let response = await sendRequest(req_cookies, url, {method: 'GET'});

    const body = await response.json();
    let tracks = body['tracks']['items'];
    let ids = tracks.map(getID);
    // if (ids.length < 60) {
    //     let artists = await getMostCommonArtists(tracks);
    //     let new_songs = await getRecommendations(10, ids.slice(0, 2), artists, req_cookies);
    //     ids.push(new_songs)
    // }
    return ids;
}

async function getSongs(album_id, req_cookies) {
    let url = 'https://api.spotify.com/v1/playlists/' + album_id;
    let response = await sendRequest(req_cookies, url, {method: 'GET'});

    const body = await response.json();
    let song_data = await body['tracks']['items'];
    return song_data.map(getID2);
}

async function getMostCommonArtists(tracks) {
    let data =  {};
    for (let i = 0; i < tracks.length; i++) {
        for (let j = 0; j < tracks[i]['artists'].length; j++) {
            if (tracks[i]['artists'][j]['id'] in data) {
                data[tracks[i]['artists'][j]['id']] += 1;
            } else {
                data[tracks[i]['artists'][j]['id']] = 1
            }
        }
    }
    // Create items array
    let items = Object.keys(data).map(function(key) {
        return [key, data[key]];
    });

    // Sort the array based on the second element
    items.sort(function(first, second) {
        return second[1] - first[1];
    });

    // Create a new array with only the first 5 items
    let result = [];
    for (let i = 0; i < items.slice(0, 3).length; i++) {
        result.push(items[i][0])
    }
    return result;
}

async function getRecommendations(songs, position, genre, num_songs, req_cookies) {
    let url = 'https://api.spotify.com/v1/recommendations?';
    url += 'limit='+num_songs.toString();
    let artists = await getMostCommonArtists(songs);
    url += '&market=US&seed_artists=' + artists.join();
    url += '&seed_genres=' + genre;
    url += '&seed_tracks=' + songs[position]['id'];
    url += '&min_popularity=20';
    let response = await sendRequest(req_cookies, url, {method: 'GET'});
    const body = await response.json();
    return body['tracks'];
}

async function getHypePart(id, interval, req_cookies) {
    let url = 'https://api.spotify.com/v1/audio-analysis/' + id;
    let response = await sendRequest(req_cookies, url, {method: 'GET'});
    const in_json = await response.json();

    let sections = in_json['segments'];
    let max_loudness = -1000;
    let max_index = -1;

    for (let i = 0; i < sections.length; i++) {
        if (sections[i]['loudness_max'] > max_loudness) {
            max_loudness = sections[i]['loudness_max'];
            max_index = i;
        }
    }
    // Now we have the loudest part, we want the stuff around
    let min_padding = Math.floor(interval / 3);
    let time_before = -sections[max_index]['duration'];
    let start_position = max_index;
    while (start_position >= 0) {
        time_before += sections[start_position]['duration'];
        if (time_before > min_padding) {
            break;
        }
        start_position -= 1
    }
    let time_after = -sections[max_index]['duration'];
    let end_position = max_index;
    while (end_position < sections.size - 1) {
        time_after += sections[end_position]['duration'];
        if (time_after > min_padding) {
            break;
        }
        end_position += 1
    }
    let total_time = time_before + sections[max_index]['duration'] + time_after;
    while (total_time < interval) {
        if (start_position > 0 && end_position < sections.size - 1) {
            if (sections[start_position]['max_loudness'] > sections[end_position]['max_loudness']) {
                total_time += sections[start_position]['duration'];
                start_position -= 1;
            }
            else {
                total_time += sections[end_position]['duration'];
                end_position += 1;
            }
        } else if (start_position > 0) {
            total_time += sections[start_position]['duration'];
            start_position -= 1;
        } else if (end_position < sections.size - 1) {
            total_time += sections[end_position]['duration'];
            end_position += 1;
        } else {
            return 0;
        }
    }
    return sections[start_position]['start']
}

function getUniqueArtistsSongs(tracks) {
    let data = {};
    let songs = [];
    let artists = [];
    for (let i = 0; i < tracks.length; i++) {
        let temp_dict = {};
        temp_dict['id'] = tracks[i]['track']['id'];
        temp_dict['name'] = tracks[i]['track']['name'];
        songs.push(temp_dict);
        for (let j = 0; j < tracks[i]['track']['artists'].length; j++) {
            if (!(tracks[i]['track']['artists'][j]['id'] in data)) {
                data[tracks[i]['track']['artists'][j]['id']] = 1;
                let temp_dict = {};
                temp_dict['id'] = tracks[i]['track']['artists'][j]['id'];
                temp_dict['name'] = tracks[i]['track']['artists'][j]['name'];
                artists.push(temp_dict);
            }
        }
    }
    return [artists, songs]
}

async function getPlaylistData(req_cookies, album_id) {
    let url = 'https://api.spotify.com/v1/playlists/' + album_id;
    let response = await sendRequest(req_cookies, url, {method: 'GET'});
    const body = await response.json();

//    let songs_and_artists = getUniqueArtistsSongs(body['tracks']['items']);

    return {'num_songs': body['tracks']['items'].length}//, 'songs': songs_and_artists[1], 'artists': songs_and_artists[0]}
}

async function beerTrack(req_cookies) {
    let url = 'https://api.spotify.com/v1/me/player/play';
    let main_body = {'uris': ['spotify:track:6eBHoGG2sSeaksUJyWPrde']};
    let data = {method: 'PUT', body: JSON.stringify(main_body)};
    await sendRequest(req_cookies, url, data);
}

async function getPlaylists(req_cookies) {
    let url = 'https://api.spotify.com/v1/me/playlists?limit=25';
    let response = await sendRequest(req_cookies, url, {method: 'GET'});
    let json_items = await response.json();
    let items = json_items['items'];
    let result = [];
    for (let i = 0; i < items.length; i++) {
        result.push({'id': items[i]['id'], 'name': items[i]['name']})
    }
    return result;
}

async function getGenres(req_cookies) {
    let url = 'https://api.spotify.com/v1/recommendations/available-genre-seeds';
    let response = await sendRequest(req_cookies, url, {method: 'GET'});
    let json_items = await response.json();
    return json_items['genres']
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function playSong(song_id, beer, interval, req_cookies) {
    let url = 'https://api.spotify.com/v1/me/player/play';
    let start_time = await getHypePart(song_id, interval, req_cookies);
    let body = {'uris': ['spotify:track:'+song_id], 'position_ms': start_time*1000};
    await sendRequest(req_cookies, url, {method: 'PUT', body: JSON.stringify(body)});
    if (beer) {
        await delay(interval * 1000 - 2199 - 1000); // to account for lag of requests
        await beerTrack(req_cookies);
    } else{
        await delay(interval * 1000 - 1000); // to account for lag of requests
    }
}

async function play_modified(album_id, beer_sound, num_songs, interval, genre, req_cookies) {
    let songs = await getSongs(album_id, req_cookies);
    let cur_recommendation = 0;
    for (let i = 0; i < num_songs; i++) {
        if (i >= songs.length - 1) {
            let num_tracks = Math.min(num_songs - i, 100);
            let new_tracks = await getRecommendations(songs, cur_recommendation, genre, num_tracks, req_cookies);
            for (let j = 0; j < new_tracks.length; j++) {
                if (songs.indexOf(new_tracks[j]) === -1) songs.push(new_tracks[j]);
            }
            cur_recommendation += 1;
        }
        await playSong(songs[i]['id'], beer_sound, interval, req_cookies);
    }
}

function shuffleSongs(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function sleep(fn, time, ...args) {
    let tmp = await timeout(time*1000);
    fn(...args);
    return tmp
}

async function play(album_id, beer_sound, num_songs, interval, shuffle, req_cookies) {
    let songs = await getSongs(album_id, req_cookies);
    if (shuffle) shuffleSongs(songs);

    for (let i = 0; i < num_songs; i++) {
        let tmp = setTimeout( function() { playSong(songs[i]['id'], beer_sound, interval, req_cookies); }, interval*i*1000)
        timeouts.push(tmp);
        //await playSong(songs[i]['id'], beer_sound, interval, req_cookies);
    }
}

router.use(bodyParser.urlencoded({ extended: false }));

router.post('/radio', async function(req, res) {
    res.render('success');
    await play_modified(req.body['playlist'],
        req.body['beer_sound'] === 'on',
        parseInt(req.body['num_songs']),
        parseFloat(req.body['interval']),
        req.body['genre'],
        req.cookies);
});

router.post('/clear', async function(req, res) {
    for (let i = 0; i < timeouts.length; i++) {
        clearTimeout(timeouts[i]);
    }
    res.sendStatus(200);
});

router.post('/play' , async function(req, res) {
    let playlist_data = await getPlaylistData(req.cookies, req.body['playlist']);
    let interval = Math.max(parseFloat(req.body['interval']), 5);

    let num_songs = Math.max(parseInt(req.body['num_songs']), 1);

    if (playlist_data['num_songs'] < num_songs) {
        let genres = await getGenres(req.cookies);
        res.render('intermediate', {
            playlist: req.body['playlist'],
            beer: req.body['beer_sound'] === 'on',
            num_songs: num_songs,
            interval: interval,
            genres: genres});
    } else {
        res.render('success');
        await play(req.body['playlist'],
            req.body['beer_sound'] === 'on',
            num_songs,
            interval,
            req.body['shuffle'] === 'on',
            req.cookies);
    }
});

router.use('/', async function(req, res) {
    let playlists = await getPlaylists(req.cookies);
    res.render('application', {playlists:playlists});
});

module.exports = router;