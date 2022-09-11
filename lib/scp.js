const path = require('path');
const scpClient = require('scp2') // 引入scp2
const ora = require('ora')
const chalk = require('chalk')
const spinner = ora('正在发布到服务器...')
const fsPromises = require('fs').promises;
const Client = require('ssh2').Client

const conn = new Client()
const NODE_ENV = process.env.NODE_ENV;

const SCP_UPLOAD_PATH = path.resolve(__dirname, '../dist'); // 需要上传代码的文件目录
const PATH = NODE_ENV === "production" ? "/usr/local/web/test" : "/usr/local/web/test"; // 文件上传到服务器的位置
const DIR_MAX_LEN=2; // 保留版本 
const IS_REMOVE_END_PATH=false; // 上传成功是否删除 dist 目录
const server = {
    host: '', // 服务器的IP地址
    port: '22', // 服务器端口
    username: '', // 用户名
    password: '', // 密码
    path: PATH + '/dist', // 项目部署的服务器目标位置
    // command: `rm -rf ${PATH}` // 是否先删除文件 暂时未开启没用， conn.exec(server.command）开启
}

class utils {
	
    static dirListSort(dirList) {
        dirList = JSON.parse(JSON.stringify(dirList));
        dirList.sort((a, b) => {
            const reg = /^((?!\d).)*/;
            const a_num = a.filename.replace(reg, '') || 0 * 1
            const b_num = b.filename.replace(reg, '') || 0 * 1
            return a_num - b_num
        })
        return dirList
    }
	
}
const fsRm = (filePath) => {
	
    return fsPromises.rm(filePath, {
        force: true,
        recursive: true
    })
	
}

const reName = (sftp, oldPath, newPath) => {
	
    return new Promise((resolve, reject) => {
        sftp.rename(oldPath, newPath, (err) => {
            if (err) reject('重命名错误了！' + err);
            resolve()
        })
    })
	
}

const readDir = (sftp, path) => {
	
    return new Promise((resolve, reject) => {
        sftp.readdir(path, (err, list) => {
            if (err) reject('读取文件夹错误了！' + err);
            resolve(list)
        })
    })
	
}

const rmDir = async (sftp, rmFileName) => {
	
    const unlink = (sftp, path) => {
        return new Promise(async (resolve, reject) => {
            sftp.unlink(path, (err) => {
                if (err) reject(err)
                resolve()
            })
        })
    }

    const rmdir = (sftp, path) => {
        return new Promise(async (resolve, reject) => {
            sftp.rmdir(path, (err) => {
                if (err) reject(err)
                resolve()
            })
        })
    }

    const deepRemoveFrame = async (sftp, rmFileName) => {
        const filePath = rmFileName;
        const dirList = await readDir(sftp, filePath);
        return Promise.all(dirList.map(async file => {
            let isDir = true;
            if (/\./.test(file.filename)) {
                isDir = false;
            }
            return await deepRemoveFile(sftp, isDir, file, filePath)
        }));
    }

    const deepRemoveFile = async (sftp, isDir, file, filePath) => {
        if (isDir) {
            filePath += '/' + file.filename
            await deepRemoveFrame(sftp, filePath)
            await rmdir(sftp, filePath)
        } else {
            await unlink(sftp, path.resolve(filePath, './' + file.filename))
        }
        return true
    }

    return new Promise(async (resolve, reject) => {
        try {
            const _path = path.resolve(PATH, './' + rmFileName)
            await deepRemoveFrame(sftp, _path)
            await rmdir(sftp, _path)
            resolve()
        } catch (e) {
            console.error('删除文件报错了！！！');
            reject(e)
        }
    })
	
}

const handleDirFile = (sftp) => {
	
    return new Promise(async (resolve, reject) => {
        try {
            const dirMaxLen = DIR_MAX_LEN;
            const dirList = await readDir(sftp, PATH);
            const isMaximum = dirList.length >= dirMaxLen ? true : false;
            resolve({
                dirList,
                isMaximum,
                dirMaxLen,
            })
        } catch (e) {
            reject(e)
        }
    })
	
}

const handleRenameDirname = (sftp, params) => {
	
    return new Promise(async (resolve, reject) => {
        try {
            const { dirList } = params;
            const reg = /^((?!\d).)*/;
            const dirListSortResult = utils.dirListSort(dirList);
            const firstName = dirListSortResult[0].filename;
            const lastName = dirListSortResult[dirListSortResult.length - 1].filename.replace(reg, '');
            const newName = firstName + '_' + (lastName*1 + 1)
            await reName(sftp, path.resolve(PATH, './' + firstName), path.resolve(PATH, './' + newName))
            resolve()
        } catch (e) {
            reject(e)
        }
    })
	
}

const handleRmFile = (sftp, params) => {
	
    return new Promise(async (resolve, reject) => {
        try {
            const { dirList, dirMaxLen } = params;
            const defaultIdx = 1;
            const dirListSortResult = utils.dirListSort(dirList);
            const rmFileName = dirListSortResult[defaultIdx].filename;
            await rmDir(sftp, rmFileName)
            resolve()
        } catch (e) {
            reject(e)
        }
    })
	
}

conn.on('ready', () => {
    conn.exec('uptime', (err, stream) => {
        if (err) { throw err }
        stream.on('close', () => {
            conn.sftp(async (err, sftp) => {
                try {
                    if (err) throw err;
                    spinner.start()
                    if(DIR_MAX_LEN!==1){
                        const { dirList, isMaximum, dirMaxLen } = await handleDirFile(sftp);
                        if (isMaximum) await handleRmFile(sftp, { dirList, dirMaxLen });
                        if (dirList.length > 0 && dirMaxLen > 1) await handleRenameDirname(sftp, { dirList });
                    }
                    scpClient.scp(
                        SCP_UPLOAD_PATH, // 本地打包文件的位置
                        {
                            host: server.host,
                            port: server.port,
                            username: server.username,
                            password: server.password,
                            path: server.path
                        },
                        async (err) => {
                            if (err) {
                                console.log(chalk.red('发布失败!'))
                                throw err
                            } else {
                                if(IS_REMOVE_END_PATH){
                                    await fsRm(SCP_UPLOAD_PATH); // 删除本地文件夹
                                }
                                console.log(chalk.green('项目发布成功!'))
                            }
                            spinner.stop()
                        }
                    )
                } catch (e) {
                    console.error(e)
                    spinner.stop()
                } finally {
                    conn.end()
                }
            });
        }).on('data', (data) => {
            console.log('STDOUT: ' + data)
        }).stderr.on('data', (data) => {
            console.log('STDERR: ' + data)
        })
    })
}).connect({
    host: server.host,
    port: server.port,
    username: server.username,
    password: server.password
})


